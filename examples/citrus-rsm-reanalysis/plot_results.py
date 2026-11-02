"""Generate the report's three separate figures after running analyse.py."""
from pathlib import Path
import csv, json
import numpy as np
import matplotlib.pyplot as plt
from analyse import load_data, design, CENTRE, SCALE

project = Path(__file__).resolve().parent
results = json.loads((project / 'results/analysis.json').read_text())
_, physical, coded, observed = load_data()
beta = np.array(results['models']['Full quadratic']['beta'])
figures = project / 'figures'
figures.mkdir(exist_ok=True)
with (project / 'results/diagnostics.csv').open() as f:
    diagnostics = list(csv.DictReader(f))

fig = plt.figure(figsize=(6.5, 3.55))
ax = fig.add_subplot(111)
ax.scatter(observed, [float(r['fitted_yield']) for r in diagnostics],
           marker='o', s=34, label='Fitted to all 17 records')
ax.scatter(observed, [float(r['loo_prediction']) for r in diagnostics],
           marker='x', s=44, label='Leave-one-record-out prediction')
ax.plot([1.15, 1.95], [1.15, 1.95], linestyle='--', linewidth=1, label='Prediction = observation')
ax.set_xlim(1.15, 1.95); ax.set_ylim(1.15, 1.95)
ax.set_xlabel('Reported extraction yield (%)')
ax.set_ylabel('Fitted or predicted yield (%)')
ax.legend(loc='upper left', fontsize=8.5); ax.grid(alpha=0.18)
fig.tight_layout(); fig.savefig(figures / 'PredictionCheck.png', dpi=220); plt.close(fig)

salt = np.linspace(2.45, 3.55, 201)
time = np.linspace(29, 43, 201)
salt_grid, time_grid = np.meshgrid(salt, time)
settings = np.column_stack([np.full(salt_grid.size, 8.1),salt_grid.ravel(), time_grid.ravel()])
loss = results['full_optimum']['yield_percent'] - (design((settings - CENTRE) / SCALE) @ beta)
fig = plt.figure(figsize=(6.5, 3.45)); ax = fig.add_subplot(111)
contours = ax.contour(salt_grid, time_grid, loss.reshape(salt_grid.shape),
                     levels=[0.0025, 0.005, 0.01, 0.02, 0.04, 0.08])
ax.clabel(contours, inline=True, fontsize=8.5, fmt='%.4g')
ax.scatter([3.05], [36.0], marker='*', s=110, label='Manuscript recipe')
ax.set_xlabel('NH\u2084Cl concentration (source units, %)')
ax.set_ylabel('Distillation time (min)')
ax.set_title('A = 8.1 mL/g; contours show predicted yield loss (percentage points)',fontsize=9.5,pad=10)
ax.legend(loc='upper right',fontsize=8.5)
fig.tight_layout(); fig.savefig(figures / 'OperatingRegion.png',dpi=220); plt.close(fig)

with (project / 'results/deletion.csv').open() as f:
    deletion = list(csv.DictReader(f))
fig = plt.figure(figsize=(6.5, 3.2)); ax = fig.add_subplot(111)
for model,marker in [('Full quadratic','o'),('Additive quadratic','s')]:
    rows = [r for r in deletion if r['model']==model]
    ax.plot([int(r['omitted_run']) for r in rows],[float(r['practical_loss']) for r in rows],
            marker=marker,markersize=4,linewidth=1,label=model)
ax.set_xticks(range(1,18)); ax.set_xlabel('Omitted source record (diagnostic refit only)')
ax.set_ylabel('Predicted loss at the fixed recipe\n(percentage points)'); ax.set_ylim(0,0.006)
ax.legend(fontsize=8.5); ax.grid(alpha=0.18)
fig.tight_layout(); fig.savefig(figures / 'DeletionSensitivity.png',dpi=220); plt.close(fig)
print('Three report figures generated.')
