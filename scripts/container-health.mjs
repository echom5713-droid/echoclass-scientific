// This is HTTP liveness, not proof that the optional scientific worker is ready.
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || "3000"}/api/health`, {
    signal: AbortSignal.timeout(3000),
  });
  const health = await response.json();
  if (!response.ok || health.ok !== true || health.storage !== "sqlite") process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
