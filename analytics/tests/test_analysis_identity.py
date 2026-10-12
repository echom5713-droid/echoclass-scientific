"""Identity fixtures use synthetic package trees, never classroom records."""

import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import sys

import pytest

from echoclass_analytics import identity


def _write(root: Path, relative: str, contents: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)


def test_source_digest_matches_independent_length_framed_vector(tmp_path):
    # Deliberately create in reverse order. Unicode lengths are byte lengths;
    # CRLF and a missing final newline remain exact source bytes.
    _write(tmp_path, "\u03b1.py", b"VALUE = 3\r\n")
    _write(tmp_path, "worker/runtime.py", b"VALUE = 2")
    _write(tmp_path, "__init__.py", b"VALUE = 1\n")
    framed = (
        b"\x00\x00\x00\x00\x00\x00\x00\x0b__init__.py"
        b"\x00\x00\x00\x00\x00\x00\x00\x0aVALUE = 1\n"
        b"\x00\x00\x00\x00\x00\x00\x00\x11worker/runtime.py"
        b"\x00\x00\x00\x00\x00\x00\x00\x09VALUE = 2"
        b"\x00\x00\x00\x00\x00\x00\x00\x05\xce\xb1.py"
        b"\x00\x00\x00\x00\x00\x00\x00\x0bVALUE = 3\r\n"
    )
    assert identity.source_digest(tmp_path) == "sha256:" + hashlib.sha256(framed).hexdigest()


def test_source_digest_covers_runtime_additions_renames_and_exact_bytes(tmp_path):
    _write(tmp_path, "analysis.py", b"return_value = 1\n")
    initial = identity.source_digest(tmp_path)
    _write(tmp_path, "worker.py", b"worker = True\n")
    with_worker = identity.source_digest(tmp_path)
    assert with_worker != initial
    (tmp_path / "worker.py").rename(tmp_path / "runtime.py")
    with_renamed_runtime = identity.source_digest(tmp_path)
    assert with_renamed_runtime != with_worker
    _write(tmp_path, "runtime.py", b"worker = True\r\n")
    assert identity.source_digest(tmp_path) != with_renamed_runtime


def test_source_digest_ignores_tests_caches_and_nonpython_files(tmp_path):
    _write(tmp_path, "analysis.py", b"value = 1\n")
    expected = identity.source_digest(tmp_path)
    _write(tmp_path, "tests/test_analysis.py", b"assert False\n")
    _write(tmp_path, "runtime/tests/fixture.py", b"fixture = 2\n")
    _write(tmp_path, "__pycache__/cached.py", b"cached = 3\n")
    _write(tmp_path, "runtime/__pycache__/cached.py", b"cached = 4\n")
    _write(tmp_path, "README.md", b"documentation\n")
    assert identity.source_digest(tmp_path) == expected


@pytest.mark.parametrize("relative", ["source.py", "linked_directory", "tests/link", "__pycache__/link", "readme.txt"])
def test_source_digest_rejects_every_encountered_symlink(tmp_path, relative):
    package = tmp_path / "package"
    package.mkdir()
    _write(package, "analysis.py", b"value = 1\n")
    target = tmp_path / "external"
    target.mkdir()
    _write(target, "external.py", b"external = True\n")
    link = package / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="symlinks"):
        identity.source_digest(package)


def test_source_digest_rejects_symlink_package_root(tmp_path):
    package = tmp_path / "package"
    package.mkdir()
    _write(package, "analysis.py", b"value = 1\n")
    link = tmp_path / "link"
    link.symlink_to(package, target_is_directory=True)
    with pytest.raises(ValueError, match="symlinks"):
        identity.source_digest(link)


def test_source_digest_rejects_non_directory_root(tmp_path):
    source = tmp_path / "module.py"
    source.write_bytes(b"value = 1\n")
    with pytest.raises(ValueError, match="directory"):
        identity.source_digest(source)


def test_identity_is_stable_and_reports_exact_environment():
    first = identity.get_identity()
    second = identity.get_identity()
    assert first == second
    assert set(first) == {
        "algorithm_version", "code_version", "environment_fingerprint", "environment"
    }
    assert first["algorithm_version"] == "echoclass.yield-analysis.v1"
    assert first["code_version"].startswith("sha256:")
    assert len(first["code_version"]) == 71
    environment = first["environment"]
    assert environment["python"] == {
        "implementation": platform.python_implementation(),
        "version": platform.python_version(),
    }
    assert environment["platform"] == {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
    }
    assert environment["byteorder"] == sys.byteorder
    for package in ("numpy", "pandas", "scipy", "statsmodels", "pydantic", "fastapi", "uvicorn"):
        assert environment["packages"][package] == metadata.version(package)
    assert environment["numpy_configuration"]
    encoded = json.dumps(environment, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    assert first["environment_fingerprint"] == "sha256:" + hashlib.sha256(encoded).hexdigest()


def test_environment_digest_tracks_versions_and_numerical_backend(monkeypatch):
    # Fix source digest: package files may be authored concurrently, and this
    # test concerns environment sensitivity only.
    monkeypatch.setattr(identity, "source_digest", lambda: "sha256:" + "a" * 64)
    versions = {name: "1.0" for name in ("numpy", "pandas", "scipy", "statsmodels", "pydantic", "fastapi", "uvicorn")}
    configuration = {"backend": "synthetic-\u03b1", "SIMD": ["synthetic"]}
    monkeypatch.setattr(identity.metadata, "version", versions.__getitem__)
    monkeypatch.setattr(identity.np, "show_config", lambda *, mode: configuration if mode == "dicts" else None)
    original = identity.get_identity()
    versions["fastapi"] = "1.1"
    changed_version = identity.get_identity()
    assert changed_version["environment_fingerprint"] != original["environment_fingerprint"]
    versions["fastapi"] = "1.0"
    configuration["backend"] = "synthetic-\u03b2"
    assert identity.get_identity()["environment_fingerprint"] != original["environment_fingerprint"]
    assert original["environment"]["numpy_configuration"]["backend"] == "synthetic-\u03b1"


def test_environment_rejects_nonfinite_backend_configuration(monkeypatch):
    monkeypatch.setattr(identity.np, "show_config", lambda *, mode: {"invalid": float("nan")})
    with pytest.raises(ValueError, match="Out of range float"):
        identity.get_identity()
