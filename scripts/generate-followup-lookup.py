"""Generate the public design explorer's fixed Gaussian probability lookup.

This uses only Python's standard-library math.erfc, independently of the
Monte Carlo study. --check fails if the committed browser lookup has drifted.
"""

import argparse
import json
import math
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rows = []
    for index in range(17):
        x = index / 4
        gap = abs(x * (x - 1) * (x - 3) * (x - 4))
        rows.append([
            [0.5 * math.erfc(gap * math.sqrt(n) / (2 * sigma * math.sqrt(2)))
             for n in (1, 3, 5)]
            for sigma in (1, 2, 4)
        ])
    generated = "// prettier-ignore\nconst probabilities = [\n" + "".join(
        "  " + json.dumps(row, separators=(", ", ": ")) + ",\n" for row in rows
    ) + "];\n"
    target = Path(__file__).resolve().parents[1] / "public" / "followup-design.js"
    existing = target.read_text(encoding="utf-8")
    prefix, remainder = existing.split("// BEGIN GENERATED PROBABILITIES\n", 1)
    _, suffix = remainder.split("// END GENERATED PROBABILITIES\n", 1)
    updated = prefix + "// BEGIN GENERATED PROBABILITIES\n" + generated + "// END GENERATED PROBABILITIES\n" + suffix
    if args.check:
        if existing != updated:
            raise SystemExit("Follow-up probability lookup differs: regenerate with this script.")
        print("FOLLOWUP_LOOKUP_PASS: 17 concentrations × 3 known SDs × 3 repeat counts")
    else:
        target.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main()
