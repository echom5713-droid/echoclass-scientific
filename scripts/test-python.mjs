import { spawnSync } from "node:child_process";
const result = spawnSync(process.env.ECHOCLASS_PYTHON || "python3", ["-m", "pytest", "-c", "analytics/pytest.ini", "analytics/tests", "-q"], {stdio: "inherit", env: {...process.env, OPENBLAS_NUM_THREADS:"1", OMP_NUM_THREADS:"1", MKL_NUM_THREADS:"1", NUMEXPR_NUM_THREADS:"1"}});
if (result.error) console.error("Python test environment is unavailable; install analytics/requirements.lock first.");
process.exit(result.status ?? 1);
