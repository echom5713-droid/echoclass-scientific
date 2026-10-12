"""Render the fixed follow-up calculation, with no sampling or model fitting.

Install analytics/requirements-figures.txt in an optional plotting environment.
SVG is always written; --png or --png-path also writes a raster preview.
All plotted probabilities use math.erfc, not the Monte Carlo report.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter


ROOT = Path(__file__).resolve().parents[1]
GREEN = "#235f4e"
ORANGE = "#bd652b"
INK = "#23352e"
GREY = "#737b76"
SIGMA = 2
COUNTS = (1, 3, 5)
LOCATIONS = (1, .5, 2)


def prediction_gap(x: float) -> float:
    """Absolute separation of the specified q and f, in yield percentage points."""
    return abs(x * (x - 1) * (x - 3) * (x - 4))


def analytic_error(x: float, n: int) -> float:
    """Conditional error for either known mean with common known Gaussian SD 2."""
    return .5 * math.erfc(prediction_gap(x) * math.sqrt(n) / (2 * SIGMA * math.sqrt(2)))


def verify_configuration() -> None:
    config = json.loads((ROOT / "analytics/experiments/followup-design-v1.config.json").read_text(encoding="utf-8"))
    expected = {
        "schema": "echoclass.followup-design-config.v1",
        "hypotheses": [
            {"id": "q", "formula": "6 + 4*x - x*x"},
            {"id": "f", "formula": "q(x) - x*(x-1)*(x-3)*(x-4)"},
        ],
        "original_concentrations": [0, 1, 3, 4],
        "candidate_grid": [i / 4 for i in range(17)],
        "designs": [
            {"id": "repeat_original", "concentration": 1},
            {"id": "off_center", "concentration": .5},
            {"id": "max_separation", "concentration": 2},
        ],
        "noise_standard_deviations": [1, 2, 4],
        "replicate_counts": list(COUNTS),
    }
    if any(config.get(key) != value for key, value in expected.items()):
        raise ValueError("Figure requires the declared fixed follow-up configuration")


def style(axis) -> None:
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["bottom", "left"]].set_color("#bac1bb")
    axis.tick_params(colors=INK)
    axis.set_axisbelow(True)
    axis.grid(axis="y", color="#e6e9e3", linewidth=.7)


def render():
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 11, "text.color": INK,
        "axes.labelcolor": INK, "axes.titlecolor": INK, "svg.fonttype": "none",
        "svg.hashsalt": "echoclass-followup-design-v1", "figure.facecolor": "#ffffff",
    })
    fig, (gap_axis, error_axis) = plt.subplots(1, 2, figsize=(12.1, 6.6))
    fig.subplots_adjust(left=.082, right=.965, bottom=.305, top=.755, wspace=.32)
    fig.text(.065, .945, "Where would you measure next?", fontsize=21, color=INK, weight="bold")
    fig.text(.065, .887, "Two specified hypotheses · location chosen before sampling · analytic error probabilities", fontsize=11, color=GREY)

    x_values = [i / 200 for i in range(801)]
    grid = [i / 4 for i in range(17)]
    gap_axis.plot(x_values, [prediction_gap(x) for x in x_values], color=GREEN, linewidth=2.5, zorder=2)
    gap_axis.scatter(grid, [prediction_gap(x) for x in grid], facecolors="white", edgecolors=GREEN,
                     s=17, linewidths=.9, zorder=3)
    gap_axis.scatter([0, 1, 3, 4], [0, 0, 0, 0], color=INK, s=42, zorder=4)
    gap_axis.scatter([2], [4], facecolors="white", edgecolors=GREEN, linewidths=2.4, s=92, zorder=5)
    gap_axis.scatter([.5], [prediction_gap(.5)], color=ORANGE, s=55, zorder=5)
    gap_axis.axvline(2, color=GREEN, linewidth=.8, linestyle=":", alpha=.6)
    gap_axis.annotate("Selected: x = 2\ngap = 4", xy=(2, 4), xytext=(2.62, 4.05),
                      fontsize=10.5, color=GREEN,
                      arrowprops={"arrowstyle": "-", "color": GREEN, "linewidth": .9})
    gap_axis.annotate("x = 0.5\ngap = 2.1875", xy=(.5, prediction_gap(.5)), xytext=(.03, 3.25),
                      fontsize=10, color=ORANGE,
                      arrowprops={"arrowstyle": "-", "color": ORANGE, "linewidth": .9})
    gap_axis.set(title="A   Separation between the responses", xlabel="NH₄Cl concentration, x / %",
                 ylabel="Absolute gap / yield percentage points", xlim=(-.12, 4.12), ylim=(-.2, 4.8),
                 xticks=[0, 1, 2, 3, 4], yticks=[0, 1, 2, 3, 4])
    gap_axis.set_title(gap_axis.get_title(), fontsize=12, pad=16)
    style(gap_axis)

    for x, colour, marker in [(1, GREY, "s"), (.5, ORANGE, "o"), (2, GREEN, "D")]:
        probabilities = [analytic_error(x, n) for n in COUNTS]
        error_axis.plot(COUNTS, probabilities, color=colour, marker=marker, linewidth=2.2,
                        markersize=6, linestyle="--" if x == 1 else "-", zorder=3)
        error_axis.annotate(f"x = {x:g}\n{probabilities[-1]:.2%}", xy=(5, probabilities[-1]),
                            xytext=(10, 0), textcoords="offset points", color=colour,
                            fontsize=10.5, va="center")
    error_axis.set(title="B   Wrong-hypothesis probability", xlabel="Independent readings at one concentration, n",
                   ylabel="Analytic conditional error", xlim=(.72, 6.1), ylim=(-.025, .55),
                   xticks=list(COUNTS), yticks=[0, .1, .2, .3, .4, .5])
    error_axis.yaxis.set_major_formatter(PercentFormatter(xmax=1, decimals=0))
    error_axis.set_title(error_axis.get_title(), fontsize=12, pad=16)
    style(error_axis)

    fig.text(.082, .19, "Black dots: original points; gap = 0 at each.\nOpen dots: fixed candidate grid, spaced by 0.25%.", fontsize=9.8, color=GREY, linespacing=1.5, va="top")
    fig.text(.585, .19, "Known Gaussian SD = 2 yield percentage points.\nLines join the three declared replication counts.", fontsize=9.8, color=GREY, linespacing=1.5, va="top")
    fig.text(.065, .087, r"$q(x)=6+4x-x^2$;  $f(x)=q(x)-x(x-1)(x-3)(x-4)$.", fontsize=10.5, color=INK)
    fig.text(.065, .041, "Only q versus f: independent readings, equal error costs and priors. No fitted model, Monte Carlo rates or chemistry validation.", fontsize=9.7, color=GREY)
    return fig


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs/figures")
    parser.add_argument("--png", action="store_true", help="Also write followup-design.png in the output directory")
    parser.add_argument("--png-path", type=Path, help="Write the optional PNG preview to this exact path")
    args = parser.parse_args()
    verify_configuration()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    figure = render()
    svg_target = args.output_dir / "followup-design.svg"
    figure.savefig(svg_target, metadata={"Date": None})
    # Matplotlib wraps path coordinates with trailing spaces; normalize only
    # line endings so the reproducible artifact also passes git diff --check.
    svg_target.write_text("\n".join(line.rstrip() for line in svg_target.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
    png_target = args.png_path or (args.output_dir / "followup-design.png" if args.png else None)
    if png_target is not None:
        png_target.parent.mkdir(parents=True, exist_ok=True)
        figure.savefig(png_target, dpi=170)
    plt.close(figure)
    print("Analytic conditional errors; known Gaussian SD = 2 yield percentage points")
    print("| x / % | Gap / percentage points | n = 1 | n = 3 | n = 5 |")
    print("| ---: | ---: | ---: | ---: | ---: |")
    for x in LOCATIONS:
        values = " | ".join(f"{analytic_error(x, n):.2%}" for n in COUNTS)
        print(f"| {x:g} | {prediction_gap(x):g} | {values} |")


if __name__ == "__main__":
    main()
