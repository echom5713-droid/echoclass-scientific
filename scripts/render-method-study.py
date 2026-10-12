"""Render the committed study with Matplotlib; no model fitting or data selection.

Install analytics/requirements-figures.txt in a separate optional environment.
The JSON retains all exact values; figures and the printed table round for display.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
GREEN = "#235f4e"
ORANGE = "#bd652b"
INK = "#23352e"
BLUE = "#456f96"
GREY = "#737b76"


def style(axis):
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["bottom", "left"]].set_color("#bac1bb")
    axis.tick_params(colors=INK)
    axis.set_axisbelow(True)
    axis.grid(axis="y", color="#e6e9e3", linewidth=.7)


def save(figure, target):
    figure.savefig(target.with_suffix(".svg"), metadata={"Date": None})
    figure.savefig(target.with_suffix(".png"), dpi=170)
    plt.close(figure)


def alias_figure(output):
    x = [index / 150 for index in range(601)]
    q = [6 + 4 * value - value * value for value in x]
    f = [6 + 4 * (value - 2)**2 - (value - 2)**4 for value in x]
    fig, ax = plt.subplots(figsize=(9.4, 5.25))
    fig.subplots_adjust(left=.1, right=.96, bottom=.2, top=.76)
    fig.text(.1, .945, "Same observations. Different unseen responses.", fontsize=19, color=INK, weight="bold")
    fig.text(.1, .89, "Designed counterexample · noiseless generating curves", fontsize=11, color=GREY)
    ax.plot(x, q, color=GREEN, linewidth=2.7, label="Concave quadratic")
    ax.plot(x, f, color=ORANGE, linewidth=2.7, linestyle="--", label="Aliased quartic")
    ax.scatter([0, 1, 3, 4], [6, 9, 9, 6], color=INK, s=45, zorder=4, label="Shared generating means")
    ax.axvline(2, color=GREY, linewidth=1, linestyle=":")
    ax.scatter([2, 2], [10, 6], facecolors="white", edgecolors=[GREEN, ORANGE], s=75, linewidths=2, zorder=5)
    ax.annotate("10%: peak", xy=(2, 10), xytext=(2.2, 10.35), color=GREEN, fontsize=11)
    ax.annotate("6%: trough", xy=(2, 6), xytext=(2.2, 5.65), color=ORANGE, fontsize=11)
    ax.set(xlim=(-.15, 4.15), ylim=(5.3, 10.95), xticks=[0, 1, 2, 3, 4], yticks=[6, 8, 10],
           xlabel="NH₄Cl concentration / %", ylabel="Yield / %")
    ax.legend(loc="lower left", bbox_to_anchor=(-.012, 1.015), ncol=3, frameon=False, fontsize=10, handlelength=2)
    style(ax)
    fig.text(.1, .055, "Only 0%, 1%, 3% and 4% are observed. Neither curve is a claim about real citrus chemistry.", fontsize=10, color=GREY)
    save(fig, output / "observational-alias")


def comparison_figure(study, output):
    scenarios = study["scenarios"]
    labels = ["Constant", "Linear", "Quadratic / low noise", "Quadratic / higher noise", "Aliased quartic"]
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 6.1), sharey=True)
    fig.subplots_adjust(left=.23, right=.97, bottom=.22, top=.73, wspace=.14)
    fig.text(.06, .945, "A good validation score cannot resolve an unseen shape.", fontsize=18, color=INK, weight="bold")
    fig.text(.06, .89, "Five fixed synthetic scenarios · twelve paired seeds · all three models retained", fontsize=11, color=GREY)
    for axis, metric, title in zip(axes, ["loco", "unseen_grid"], ["Held-out concentration means", "Unseen noiseless response grid"]):
        for model, colour, marker, offset in [("constant", GREY, "o", -.18), ("linear", BLUE, "s", 0), ("quadratic", GREEN, "D", .18)]:
            values = [scenario["summary"]["models"][model][metric]["pooled_rmse"] for scenario in scenarios]
            if any(value is None for value in values):
                raise ValueError("Figure requires available metrics; report missing values explicitly before rendering")
            axis.scatter(values, [index + offset for index in range(5)], color=colour, marker=marker, s=42, label=model.capitalize(), zorder=4)
        axis.set(title=title, xlabel="Pooled RMSE / yield percentage points", xlim=(0, 3.8), xticks=[0, 1, 2, 3], yticks=list(range(5)), yticklabels=labels)
        axis.grid(axis="x", color="#e6e9e3", linewidth=.7)
        style(axis)
        axis.axhspan(3.55, 4.45, color="#fbf0e7", zorder=0)
    axes[0].invert_yaxis()
    handles, names = axes[0].get_legend_handles_labels()
    fig.legend(handles, names, loc="upper left", bbox_to_anchor=(.224, .865), ncol=3, frameon=False)
    fig.text(.06, .09, "Left predicts noisy group means; right compares with known synthetic truth at 13 unmeasured concentrations.", fontsize=10, color=GREY)
    fig.text(.06, .052, "Dots pool squared errors across all 12 trials. No confidence intervals, model selection or real-world accuracy claim.", fontsize=10, color=GREY)
    save(fig, output / "method-comparison")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "resources/experiments/method-study-v1.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs/figures")
    args = parser.parse_args()
    study = json.loads(args.input.read_text())
    if study["schema"] != "echoclass.method-study.v1" or study["trial_count"] != 60:
        raise ValueError("Expected the fixed sixty-trial study")
    quiet, alias = study["scenarios"][2], study["scenarios"][4]
    assert quiet["id"] == "quadratic_quiet" and alias["id"] == "aliased_quartic"
    for first, second in zip(quiet["trials"], alias["trials"], strict=True):
        assert first["dataset_hash"] == second["dataset_hash"]
        assert first["scientific_result_hash"] == second["scientific_result_hash"]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"font.family":"DejaVu Sans", "font.size":11, "text.color":INK, "axes.labelcolor":INK,
                         "svg.fonttype":"none", "svg.hashsalt":"echoclass-method-study-v1", "figure.facecolor":"#ffffff"})
    alias_figure(args.output_dir)
    comparison_figure(study, args.output_dir)
    print("| Scenario | Model | LOCO RMSE | Unseen-grid RMSE |")
    print("| --- | --- | ---: | ---: |")
    for scenario in study["scenarios"]:
        for model, metrics in scenario["summary"]["models"].items():
            print(f"| {scenario['label']} | {model} | {metrics['loco']['pooled_rmse']:.4f} | {metrics['unseen_grid']['pooled_rmse']:.4f} |")


if __name__ == "__main__":
    main()
