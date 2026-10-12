"""Real supervised processes using only temporary locks and synthetic credentials."""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time
import unittest


ANALYTICS_ROOT = Path(__file__).resolve().parents[1]
TOKEN = "synthetic-worker-process-credential-" + "x" * 40
OUTPUT_LIMIT = 65_536
START_TIMEOUT = 15.0

# This supervisor owns its descriptor separately from the unittest process.
# Killing it therefore tests actual reparenting, not a mocked PID check.
SUPERVISOR = r"""
import json, os, pathlib, selectors, subprocess, sys, time
fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
env = dict(os.environ)
env['ECHOCLASS_WORKER_LOCK_FD'] = str(fd)
env['ECHOCLASS_WORKER_PARENT_PID'] = str(os.getpid())
worker = subprocess.Popen(
    [sys.executable, '-m', 'echoclass_analytics.worker'],
    env=env, pass_fds=(fd,), stdin=subprocess.DEVNULL,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
selector = selectors.DefaultSelector()
selector.register(worker.stdout, selectors.EVENT_READ)
buffer = bytearray()
deadline = time.monotonic() + 15
try:
    while b'\n' not in buffer:
        if time.monotonic() >= deadline:
            raise RuntimeError('SYNTHETIC_SUPERVISOR_READY_TIMEOUT')
        for key, _ in selector.select(min(0.2, deadline - time.monotonic())):
            piece = os.read(key.fileobj.fileno(), 4096)
            if not piece:
                raise RuntimeError('SYNTHETIC_SUPERVISOR_CHILD_EXITED')
            buffer.extend(piece)
            if len(buffer) > 65536:
                raise RuntimeError('SYNTHETIC_SUPERVISOR_OUTPUT_LIMIT')
    event = json.loads(bytes(buffer).split(b'\n', 1)[0])
    if event.get('event') != 'ready' or event.get('pid') != worker.pid:
        raise RuntimeError('SYNTHETIC_SUPERVISOR_BAD_READY')
    # /proc can be mounted from an outer PID namespace in a test container.
    # The pidfd identifies this exact child without scanning other processes.
    pidfd = os.pidfd_open(worker.pid)
    try:
        info = pathlib.Path(f'/proc/self/fdinfo/{pidfd}').read_text()
        event['proc_pid'] = int(next(line.split()[1] for line in info.splitlines()
                                     if line.startswith('Pid:')))
    finally:
        os.close(pidfd)
    print(json.dumps(event, separators=(',', ':')), flush=True)
    sys.stdin.buffer.read(1)
finally:
    selector.close()
    if worker.poll() is None:
        worker.terminate()
        try:
            worker.wait(timeout=3)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait(timeout=3)
    os.close(fd)
"""

LOCK_PROBE = r"""
import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR)
try:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(73)
finally:
    os.close(fd)
"""


def process_state(pid: int) -> tuple[str, str] | None:
    """Return state/start identity; a reparented zombie is no longer running."""
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    except (FileNotFoundError, ProcessLookupError):
        return None
    return fields[0], fields[19]


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux flock and /proc contract")
class WorkerProcessTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="echoclass-synthetic-worker-")
        self.root = Path(temporary.name)
        self.lock_file = self.root / "worker.lock"
        self.processes: list[subprocess.Popen] = []
        self.descriptors: list[int] = []
        self.grandchildren: list[tuple[int, int, str]] = []
        self.outputs: dict[int, dict[str, bytearray]] = {}
        self.addCleanup(temporary.cleanup)
        self.addCleanup(self.close_descriptors)
        self.addCleanup(self.stop_processes)

    def close_descriptors(self) -> None:
        for descriptor in self.descriptors:
            os.close(descriptor)
        self.descriptors.clear()

    def stop_processes(self) -> None:
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
        # Only signal descendants created by this fixture, with their original
        # /proc start identity, and never mistake a reparented zombie for life.
        for pid, proc_pid, started in self.grandchildren:
            state = process_state(proc_pid)
            if state is not None and state[1] == started and state[0] != "Z":
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def open_lock(self) -> int:
        descriptor = os.open(self.lock_file, os.O_CREAT | os.O_RDWR, 0o600)
        self.descriptors.append(descriptor)
        return descriptor

    def environment(self) -> dict[str, str]:
        env = dict(os.environ)
        env["PYTHONPATH"] = str(ANALYTICS_ROOT)
        env["PYTHONUNBUFFERED"] = "1"
        env["ECHOCLASS_WORKER_TOKEN"] = TOKEN
        env["ECHOCLASS_WORKER_PARENT_PID"] = str(os.getpid())
        return env

    def spawn(self, arguments: list[str], *, env=None, pass_fds=(), stdin=None):
        process = subprocess.Popen(
            arguments,
            cwd=ANALYTICS_ROOT,
            env=self.environment() if env is None else env,
            pass_fds=pass_fds,
            stdin=subprocess.DEVNULL if stdin is None else stdin,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.processes.append(process)
        self.outputs[process.pid] = {"stdout": bytearray(), "stderr": bytearray()}
        return process

    def worker(self, descriptor: int | None, *, changes=None):
        env = self.environment()
        env["ECHOCLASS_WORKER_LOCK_FD"] = str(descriptor if descriptor is not None else 999_999)
        for key, value in (changes or {}).items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return self.spawn(
            [sys.executable, "-m", "echoclass_analytics.worker"],
            env=env,
            pass_fds=() if descriptor is None else (descriptor,),
        )

    def collect(self, process, *, ready=False, timeout=START_TIMEOUT):
        output = self.outputs[process.pid]
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")
            while selector.get_map():
                if ready and b"\n" in output["stdout"]:
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.fail("Synthetic worker output deadline exceeded")
                for key, _ in selector.select(min(remaining, 0.2)):
                    piece = os.read(key.fileobj.fileno(), 4096)
                    if not piece:
                        selector.unregister(key.fileobj)
                        continue
                    output[key.data].extend(piece)
                    if len(output[key.data]) > OUTPUT_LIMIT:
                        self.fail("Synthetic worker output exceeded the bounded protocol")
        if ready:
            self.assertIn(b"\n", output["stdout"], "Worker exited before readiness")
            event = json.loads(output["stdout"].split(b"\n", 1)[0])
            self.assertEqual(event["event"], "ready")
            self.assertIsInstance(event["port"], int)
            self.assertTrue(0 < event["port"] < 65536)
            self.assertIsInstance(event["identity"], dict)
            return event
        process.wait(timeout=max(0.1, deadline - time.monotonic()))
        return output

    def assert_safe_output(self, process, *, ready: bool, expected_code=None) -> None:
        output = self.outputs[process.pid]
        for value in output.values():
            self.assertFalse(TOKEN.encode() in value, "Worker output exposed its credential")
            self.assertLessEqual(len(value), OUTPUT_LIMIT)
        stdout_lines = output["stdout"].splitlines()
        self.assertEqual(len(stdout_lines), 1 if ready else 0)
        codes = []
        for line in output["stderr"].splitlines():
            event = json.loads(line)
            self.assertEqual(set(event), {"code"})
            self.assertRegex(event["code"], r"^WORKER_[A-Z_]{1,48}$")
            codes.append(event["code"])
        if expected_code is not None:
            self.assertIn(expected_code, codes)

    def health(self, port: int, *, token=TOKEN):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
        try:
            headers = {} if token is None else {"Authorization": f"Bearer {token}"}
            connection.request("GET", "/health", headers=headers)
            response = connection.getresponse()
            body = response.read(OUTPUT_LIMIT + 1)
            self.assertLessEqual(len(body), OUTPUT_LIMIT)
            return response.status, json.loads(body)
        finally:
            connection.close()

    def assert_healthy(self, process, event) -> None:
        self.assertEqual(event["pid"], process.pid)
        status, health = self.health(event["port"])
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "ready")
        self.assertTrue(health["ready"])
        self.assertFalse(health["busy"])
        self.assertEqual(health["identity"], event["identity"])

    def stop(self, process) -> None:
        process.terminate()
        self.collect(process, timeout=5)

    def test_ready_health_and_a_competing_open_description_is_locked(self) -> None:
        original_fd = self.open_lock()
        original = self.worker(original_fd)
        event = self.collect(original, ready=True)
        self.assert_healthy(original, event)
        status, body = self.health(event["port"], token=None)
        self.assertEqual(status, 401)
        self.assertEqual(body, {"error": {"code": "WORKER_UNAUTHORIZED"}})

        competitor = self.worker(self.open_lock())
        self.collect(competitor)
        self.assertEqual(competitor.returncode, 73)
        self.assert_safe_output(competitor, ready=False, expected_code="WORKER_LOCKED")
        self.assert_healthy(original, event)
        self.stop(original)
        self.assert_safe_output(original, ready=True)

    def test_child_exit_does_not_unlock_the_parents_shared_description(self) -> None:
        parent_fd = self.open_lock()
        first = self.worker(parent_fd)
        self.collect(first, ready=True)
        self.stop(first)
        self.assert_safe_output(first, ready=True)

        probe = self.spawn([sys.executable, "-c", LOCK_PROBE, str(self.lock_file)])
        self.collect(probe, timeout=5)
        self.assertEqual(probe.returncode, 73, "Child exit must not unlock the parent's descriptor")
        self.assertEqual(self.outputs[probe.pid], {"stdout": b"", "stderr": b""})

        # Closing the last copy releases flock naturally; never issue LOCK_UN.
        os.close(parent_fd)
        self.descriptors.remove(parent_fd)
        replacement = self.worker(self.open_lock())
        self.assert_healthy(replacement, self.collect(replacement, ready=True))
        self.stop(replacement)
        self.assert_safe_output(replacement, ready=True)

    def test_worker_exits_after_its_actual_supervisor_is_killed(self) -> None:
        supervisor = self.spawn(
            [sys.executable, "-c", SUPERVISOR, str(self.lock_file)],
            stdin=subprocess.PIPE,
        )
        event = self.collect(supervisor, ready=True, timeout=START_TIMEOUT + 2)
        child_pid = event["pid"]
        self.assertNotEqual(child_pid, supervisor.pid)
        proc_pid = event["proc_pid"]
        state = process_state(proc_pid)
        self.assertIsNotNone(state)
        self.grandchildren.append((child_pid, proc_pid, state[1]))
        self.assertEqual(self.health(event["port"])[0], 200)

        supervisor.kill()
        self.collect(supervisor, timeout=5)
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            current = process_state(proc_pid)
            if current is None or current[0] == "Z" or current[1] != state[1]:
                break
            time.sleep(0.05)
        else:
            self.fail("Worker remained running after its supervisor died")
        with self.assertRaises((OSError, http.client.HTTPException)):
            self.health(event["port"])

        replacement = self.worker(self.open_lock())
        self.assert_healthy(replacement, self.collect(replacement, ready=True))
        self.stop(replacement)
        self.assert_safe_output(replacement, ready=True)
        self.assert_safe_output(supervisor, ready=True)

    def test_invalid_startup_inputs_fail_without_readiness_or_credential_output(self) -> None:
        cases = (
            ("missing-fd", None, {}),
            ("bad-parent", "lock", {"ECHOCLASS_WORKER_PARENT_PID": str(os.getpid() + 999_999)}),
            ("missing-credential", "lock", {"ECHOCLASS_WORKER_TOKEN": None}),
            ("short-credential", "lock", {"ECHOCLASS_WORKER_TOKEN": "synthetic-short"}),
            ("non-ascii-credential", "lock", {"ECHOCLASS_WORKER_TOKEN": "合成" * 32}),
        )
        for name, descriptor_type, changes in cases:
            with self.subTest(name=name):
                descriptor = self.open_lock() if descriptor_type == "lock" else None
                process = self.worker(descriptor, changes=changes)
                self.collect(process)
                self.assertEqual(process.returncode, 70)
                self.assert_safe_output(process, ready=False, expected_code="WORKER_STARTUP_FAILED")
                # Each failed child may have acquired a shared description.
                if descriptor is not None:
                    os.close(descriptor)
                    self.descriptors.remove(descriptor)


if __name__ == "__main__":
    unittest.main()
