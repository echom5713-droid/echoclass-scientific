"""Read-only local calculation; Node verifies the RFC8785 scientific result hash."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .analysis import analyze
from .identity import get_identity
from .models import MAX_REQUEST_BYTES, ProtocolError, parse_envelope


def main() -> int:
    parser = argparse.ArgumentParser(description="Reproduce a sealed EchoClass bundle without database access")
    parser.add_argument("bundle", nargs="?")
    parser.add_argument("--identity", action="store_true", help="Print actual code/environment identity only")
    args = parser.parse_args()
    identity = get_identity()
    if args.identity:
        print(json.dumps(identity, ensure_ascii=False, allow_nan=False))
        return 0
    if not args.bundle:
        parser.error("a canonical bundle path or --identity is required")
    try:
        with Path(args.bundle).open("rb") as handle:
            raw = handle.read(MAX_REQUEST_BYTES + 1)
        envelope = parse_envelope(raw)
        result = analyze(envelope)
        print(json.dumps({"result": result, "identity": identity}, ensure_ascii=False, allow_nan=False))
        return 0
    except (ProtocolError, OSError):
        print("Canonical bundle could not be verified or read", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
