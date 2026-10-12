"""Real loopback HTTP tests; synthetic calculations expose actual thread lifetime."""

from contextlib import contextmanager
import http.client
import json
import socket
import threading
import time

import pytest
import uvicorn

from echoclass_analytics.models import ProtocolError, strict_json_loads
from echoclass_analytics.worker_runtime import (
    MAX_REQUEST_BYTES,
    MAX_RESULT_BYTES,
    WorkerIdentityMismatch,
    create_app,
)

TOKEN = "synthetic-worker-test-token-" + "x" * 32
IDENTITY = {
    "algorithm_version": "synthetic-algorithm-v1",
    "code_version": "sha256:" + "a" * 64,
    "environment_fingerprint": "sha256:" + "b" * 64,
    "environment": {"fixture": "synthetic-test-only"},
}


def wait_until(condition, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.005)
    raise AssertionError("Synthetic worker condition did not finish before deadline")


@contextmanager
def http_worker(analyze=None, **options):
    if analyze is None:
        def analyze(envelope, check_budget):
            check_budget()
            return {"synthetic": True, "value": envelope.get("value", 3.0)}

    app = create_app(
        analyze=analyze,
        parse_envelope=strict_json_loads,
        verify_identity=options.pop("verify_identity", lambda *_: None),
        identity=IDENTITY,
        token=TOKEN,
        protocol_error_types=(ProtocolError,),
        **options,
    )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(
        app, log_config=None, log_level="critical", access_log=False,
        loop="asyncio", timeout_graceful_shutdown=0.2,
    ))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]})
    thread.start()
    wait_until(lambda: server.started)
    try:
        yield port, app.state.runtime
    finally:
        server.should_exit = True
        app.state.runtime.close()
        thread.join(4)
        listener.close()
        assert not thread.is_alive(), "Actual HTTP server did not stop"


def request(port, method="POST", route="/v1/analyze", body=b"{}", headers=None, *, chunked=False):
    selected = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
    if headers:
        selected.update(headers)
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request(method, route, body=body, headers=selected, encode_chunked=chunked)
        result = connection.getresponse()
        return result.status, dict(result.getheaders()), result.read()
    finally:
        connection.close()


def health(port):
    status, _headers, body = request(port, "GET", "/health", body=None)
    assert status == 200
    return json.loads(body)


def post_socket(port, body=b"{}"):
    connection = socket.create_connection(("127.0.0.1", port), timeout=3)
    connection.sendall(
        f"POST /v1/analyze HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n".encode("ascii") + body
    )
    return connection


def test_worker_health_and_calculation_require_credential_and_disable_docs():
    with http_worker() as (port, _runtime):
        assert health(port) == {"ready": True, "busy": False, "status": "ready", "identity": IDENTITY}
        for method, route in [("GET", "/health"), ("POST", "/v1/analyze")]:
            status, _headers, body = request(port, method, route, headers={"Authorization": "Bearer wrong"})
            assert status == 401
            assert json.loads(body) == {"error": {"code": "WORKER_UNAUTHORIZED"}}
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request(method, route, body=b"{}", headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            assert response.status == 401
            response.read()
            connection.close()
        for route in ["/docs", "/redoc", "/openapi.json"]:
            assert request(port, "GET", route)[0] == 404


def test_worker_returns_bounded_result_wrapper_with_actual_identity():
    with http_worker() as (port, _runtime):
        status, headers, body = request(port, body=b'{"value":2.75}')
        assert status == 200
        assert headers["cache-control"] == "no-store"
        assert headers["x-content-type-options"] == "nosniff"
        assert "access-control-allow-origin" not in headers
        assert json.loads(body) == {"result": {"synthetic": True, "value": 2.75}, "identity": IDENTITY}


@pytest.mark.parametrize("raw", [b"{", b'{"v":1,"v":2}', b'{"v":NaN}', b'{"v":Infinity}', b'\xff', b'\xef\xbb\xbf{}'])
def test_worker_rejects_malformed_duplicate_nonfinite_and_invalid_utf8_json(raw):
    calls = []
    with http_worker(lambda *_args, **_kwargs: calls.append(True)) as (port, _runtime):
        status, _headers, body = request(port, body=raw)
        assert status == 400
        assert json.loads(body)["error"]["code"] == "INVALID_ENVELOPE"
        assert calls == []
        assert health(port)["ready"]


@pytest.mark.parametrize("headers,route", [
    ({"Content-Type": "text/plain"}, "/v1/analyze"),
    ({"Content-Type": "application/json; charset=utf-8"}, "/v1/analyze"),
    ({"Content-Encoding": "gzip"}, "/v1/analyze"),
    ({"X-EchoClass-Comparison-Mode": "yes"}, "/v1/analyze"),
    ({}, "/v1/analyze?unknown=1"),
])
def test_worker_rejects_ambiguous_transport_options(headers, route):
    with http_worker() as (port, _runtime):
        status, _headers, body = request(port, route=route, headers=headers)
        assert status == 400
        assert json.loads(body)["error"]["code"] == "WORKER_INVALID_REQUEST"


def test_worker_rejects_repeated_authorization():
    with http_worker() as (port, _runtime):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.putrequest("GET", "/health")
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.endheaders()
            response = connection.getresponse()
            assert response.status == 401
            response.read()
        finally:
            connection.close()


def test_worker_rejects_declared_and_chunked_overflow_and_accepts_exact_boundary():
    with http_worker() as (port, _runtime):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.putrequest("POST", "/v1/analyze")
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(MAX_REQUEST_BYTES + 1))
            connection.endheaders()
            response = connection.getresponse()
            assert response.status == 413
            response.read()
        finally:
            connection.close()
        padded = b"{}" + b" " * (MAX_REQUEST_BYTES - 2)
        assert request(port, body=padded)[0] == 200
        assert request(port, body=padded + b" ", headers={"Transfer-Encoding": "chunked"}, chunked=True)[0] == 413
        assert health(port)["ready"]


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), "synthetic" * MAX_RESULT_BYTES])
def test_worker_never_sends_nonfinite_or_oversized_result(invalid):
    with http_worker(lambda *_args, **_kwargs: {"value": invalid}) as (port, _runtime):
        status, _headers, body = request(port)
        assert status == 500
        assert json.loads(body) == {"error": {"code": "WORKER_INVALID_OUTPUT"}}
        assert len(body) < 100


def test_worker_reports_safe_failure_without_echoing_exception_or_partial_result():
    def failing(_envelope, check_budget):
        check_budget()
        raise RuntimeError("synthetic-secret-observation-and-private-file-path")

    with http_worker(failing) as (port, _runtime):
        status, _headers, body = request(port)
        assert status == 500
        assert json.loads(body) == {"error": {"code": "WORKER_EXECUTION_FAILED"}}
        assert b"synthetic-secret" not in body
        assert b"Traceback" not in body


def test_disconnected_http_does_not_release_slot_while_actual_calculation_is_alive():
    started = threading.Event()
    release = threading.Event()
    ended = threading.Event()
    state = {"active": 0, "maximum": 0, "calls": 0}
    lock = threading.Lock()

    def calculating(_envelope, check_budget):
        with lock:
            state["active"] += 1
            state["calls"] += 1
            state["maximum"] = max(state["maximum"], state["active"])
        started.set()
        try:
            assert release.wait(2)
            check_budget()
            return {"synthetic": True}
        finally:
            with lock:
                state["active"] -= 1
            ended.set()

    with http_worker(calculating) as (port, _runtime):
        connection = post_socket(port)
        try:
            assert started.wait(1)
            connection.shutdown(socket.SHUT_RDWR)
            connection.close()
            assert health(port)["busy"]
            status, _headers, body = request(port)
            assert status == 503
            assert json.loads(body)["error"]["code"] == "WORKER_BUSY"
            assert state == {"active": 1, "maximum": 1, "calls": 1}
        finally:
            release.set()
            connection.close()
        assert ended.wait(1)
        wait_until(lambda: health(port)["ready"])
        assert request(port)[0] == 200
        assert state["maximum"] == 1


def test_cooperative_cpu_budget_stops_real_calculation_and_recovers_ready_slot():
    checks = []
    ended = threading.Event()

    def calculating(_envelope, check_budget):
        try:
            while True:
                sum(i * i for i in range(3000))
                checks.append(1)
                check_budget()
        finally:
            ended.set()

    with http_worker(calculating, budget_seconds=0.08, cancellation_grace_seconds=0.15) as (port, _runtime):
        status, _headers, body = request(port)
        assert status == 504
        assert json.loads(body)["error"]["code"] == "WORKER_TIMEOUT"
        assert ended.wait(1)
        assert len(checks) > 1
        wait_until(lambda: health(port)["ready"])


def test_uncooperative_cpu_work_keeps_slot_then_requires_worker_restart():
    started = threading.Event()
    ended = threading.Event()
    calls = []

    def calculating(_envelope, check_budget):
        calls.append(True)
        started.set()
        deadline = time.monotonic() + 0.6
        while time.monotonic() < deadline:
            sum(i * i for i in range(3000))
        ended.set()
        return {"synthetic": True}

    with http_worker(calculating, budget_seconds=0.05, cancellation_grace_seconds=0.05) as (port, _runtime):
        status, _headers, body = request(port)
        assert started.is_set()
        assert status == 504
        assert json.loads(body)["error"]["code"] == "WORKER_TIMEOUT"
        current = health(port)
        assert not current["ready"] and current["busy"] and current["status"] == "unavailable"
        assert request(port)[0] == 503
        assert len(calls) == 1
        assert ended.wait(2)
        wait_until(lambda: not health(port)["busy"])
        assert not health(port)["ready"]
        assert request(port)[0] == 503
        assert len(calls) == 1


def test_slow_body_deadline_releases_unstarted_reservation():
    calls = []
    with http_worker(lambda *_args, **_kwargs: calls.append(True), body_timeout_seconds=0.08) as (port, _runtime):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.putrequest("POST", "/v1/analyze")
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", "100")
            connection.endheaders()
            connection.send(b"{")
            response = connection.getresponse()
            assert response.status == 408
            assert json.loads(response.read())["error"]["code"] == "WORKER_BODY_TIMEOUT"
        finally:
            connection.close()
        assert calls == []
        assert health(port)["ready"]


def test_comparison_mode_is_explicit_and_cannot_change_algorithm_or_code():
    def verify(envelope, identity, comparison):
        if envelope["algorithm_version"] != identity["algorithm_version"] or envelope["code_version"] != identity["code_version"]:
            raise WorkerIdentityMismatch()
        if not comparison and envelope["environment_fingerprint"] != identity["environment_fingerprint"]:
            raise WorkerIdentityMismatch()

    envelope = {key: value for key, value in IDENTITY.items() if key != "environment"}
    envelope["environment_fingerprint"] = "sha256:" + "c" * 64
    with http_worker(verify_identity=verify) as (port, _runtime):
        assert request(port, body=json.dumps(envelope).encode())[0] == 409
        status, headers, body = request(port, body=json.dumps(envelope).encode(), headers={"X-EchoClass-Comparison-Mode": "numerical"})
        assert status == 200
        assert headers["x-echoclass-environment-comparison"] == "numerical"
        assert json.loads(body)["identity"] == IDENTITY
        for field in ("algorithm_version", "code_version"):
            changed = {**envelope, field: "synthetic-different"}
            assert request(port, body=json.dumps(changed).encode(), headers={"X-EchoClass-Comparison-Mode": "numerical"})[0] == 409
