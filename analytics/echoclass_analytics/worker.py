"""One supervised loopback worker. stdout carries one readiness record only."""

from __future__ import annotations

import fcntl
import json
import logging
import os
import socket
import stat
import threading
import time
import warnings

import uvicorn

from .worker_runtime import WorkerIdentityMismatch, create_app


def safe_event(code: str) -> None:
    os.write(2, (json.dumps({"code": code}, separators=(",", ":")) + "\n").encode("ascii"))


def acquire_parent_lock() -> tuple[int, int]:
    lock_fd = int(os.environ.get("ECHOCLASS_WORKER_LOCK_FD", "3"))
    parent_pid = int(os.environ["ECHOCLASS_WORKER_PARENT_PID"])
    if lock_fd < 3 or parent_pid <= 1 or os.getppid() != parent_pid:
        raise ValueError("Invalid supervisor")
    if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
        raise ValueError("Invalid supervisor lock")
    os.set_inheritable(lock_fd, False)
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # The Node parent retains this same open file description. Neither process
    # explicitly unlocks it; only closing every inherited copy releases it.
    return lock_fd, parent_pid


def watch_parent(parent_pid: int) -> None:
    while True:
        if os.getppid() != parent_pid:
            try:
                safe_event("WORKER_PARENT_LOST")
            finally:
                # The dead supervisor may also have closed our stderr pipe.
                # Logging must never prevent terminating its orphaned worker.
                os._exit(74)
        time.sleep(0.2)


def run() -> None:
    _lock_fd, parent_pid = acquire_parent_lock()
    token = os.environ["ECHOCLASS_WORKER_TOKEN"]
    threading.Thread(target=watch_parent, args=(parent_pid,), daemon=True, name="echoclass-parent").start()

    from .analysis import analyze
    from .identity import get_identity
    from .models import ProtocolError, parse_envelope, verify_envelope

    identity = get_identity()

    def verify_identity(envelope, actual_identity, comparison):
        execution = verify_envelope(envelope).execution
        if (
            execution.algorithm_version != actual_identity["algorithm_version"]
            or execution.code_version != actual_identity["code_version"]
            or (not comparison and execution.environment_fingerprint != actual_identity["environment_fingerprint"])
        ):
            raise WorkerIdentityMismatch()

    app = create_app(
        analyze=analyze,
        parse_envelope=parse_envelope,
        verify_identity=verify_identity,
        identity=identity,
        token=token,
        protocol_error_types=(ProtocolError,),
    )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.set_inheritable(False)
    port = listener.getsockname()[1]

    class ReadyServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started:
                print(json.dumps({"event": "ready", "port": port, "pid": os.getpid(), "identity": identity}, separators=(",", ":"), allow_nan=False), flush=True)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "asyncio"):
        logging.getLogger(name).disabled = True
    warnings.showwarning = lambda *_args, **_kwargs: safe_event("WORKER_LIBRARY_WARNING")
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        workers=1,
        loop="asyncio",
        access_log=False,
        log_config=None,
        server_header=False,
        date_header=False,
        timeout_keep_alive=2,
        timeout_graceful_shutdown=2,
        limit_concurrency=16,
    )
    try:
        ReadyServer(config).run(sockets=[listener])
    finally:
        listener.close()


def main() -> None:
    exit_code = 0
    try:
        run()
    except BlockingIOError:
        safe_event("WORKER_LOCKED")
        exit_code = 73
    except (KeyboardInterrupt, SystemExit):
        pass
    except BaseException:
        safe_event("WORKER_STARTUP_FAILED")
        exit_code = 70
    finally:
        # A stopped server cannot leave an uncooperative executor thread alive
        # after releasing its listening socket. Node waits for this process exit.
        os._exit(exit_code)


if __name__ == "__main__":
    main()
