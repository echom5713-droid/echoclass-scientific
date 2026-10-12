"""Deterministic identity for the deployed scientific implementation.

Source framing is shared with Node: sort relative POSIX paths by UTF-8 bytes,
then hash ``uint64be(path length) + path + uint64be(file length) + file``.
Only Python sources contribute; ``tests`` and ``__pycache__`` directories do
not. Symlinks anywhere under the package root are rejected, including inside
those excluded directories. Package runtime and worker sources are included.

Environment identity uses sorted ASCII JSON, not scientific-protocol JCS:
``json.dumps(sort_keys=True, ensure_ascii=True, separators=(',', ':'),
allow_nan=False)`` encoded as UTF-8. There are no timestamps or random values.
"""

from __future__ import annotations

import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import platform
import stat
import sys

import numpy as np


ALGORITHM_VERSION = "echoclass.yield-analysis.v1"
_PACKAGES = (
    "numpy",
    "pandas",
    "scipy",
    "statsmodels",
    "pydantic",
    "fastapi",
    "uvicorn",
)
_EXCLUDED_DIRECTORIES = frozenset({"tests", "__pycache__"})


def _raise_walk_error(error: OSError) -> None:
    raise error


def source_digest(package_root: Path | None = None) -> str:
    """Hash exact deployed package sources, failing closed on symlinks.

    ``package_root`` exists for offline verification and synthetic fixtures;
    normal execution hashes the directory containing this module. Unreadable
    paths and nonregular Python source files are errors, never skipped inputs.
    """
    root = Path(package_root) if package_root is not None else Path(__file__).parent
    root = root.absolute()
    root_mode = root.lstat().st_mode
    if stat.S_ISLNK(root_mode):
        raise ValueError("Python package source must not contain symlinks")
    if not stat.S_ISDIR(root_mode):
        raise ValueError("Python package source root must be a directory")

    sources: list[tuple[bytes, Path]] = []
    for directory, directory_names, file_names in os.walk(
        root, followlinks=False, onerror=_raise_walk_error
    ):
        # Do not prune excluded directories: their links must still be rejected.
        for name in directory_names + file_names:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                raise ValueError("Python package source must not contain symlinks")
            relative = path.relative_to(root)
            if any(part in _EXCLUDED_DIRECTORIES for part in relative.parts[:-1]):
                continue
            if path.suffix == ".py" and not stat.S_ISDIR(mode):
                if not stat.S_ISREG(mode):
                    raise ValueError("Python package source must be a regular file")
                sources.append((relative.as_posix().encode("utf-8"), path))

    digest = hashlib.sha256()
    for relative_bytes, path in sorted(sources, key=lambda source: source[0]):
        # Reject a final-component symlink even if it appears after discovery.
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as source_file:
            if not stat.S_ISREG(os.fstat(source_file.fileno()).st_mode):
                raise ValueError("Python package source must be a regular file")
            contents = source_file.read()
        digest.update(len(relative_bytes).to_bytes(8, "big"))
        digest.update(relative_bytes)
        digest.update(len(contents).to_bytes(8, "big"))
        digest.update(contents)
    return "sha256:" + digest.hexdigest()


def get_identity() -> dict[str, object]:
    """Return package, algorithm and detailed numerical-environment identities."""
    environment = {
        "python": {
            "implementation": platform.python_implementation(),
            "version": platform.python_version(),
        },
        "packages": {name: metadata.version(name) for name in _PACKAGES},
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "byteorder": sys.byteorder,
        "numpy_configuration": np.show_config(mode="dicts"),
    }
    encoded = json.dumps(
        environment,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "code_version": source_digest(),
        "environment_fingerprint": "sha256:" + hashlib.sha256(encoded).hexdigest(),
        # Detach NumPy's configuration object; callers cannot mutate its state.
        "environment": json.loads(encoded),
    }
