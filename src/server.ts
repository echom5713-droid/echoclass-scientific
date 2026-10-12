import http from "node:http";
import { GroundedService } from "./application/grounded-service.js";
import { SqliteDocumentRetriever } from "./infrastructure/database/sqlite-document-retriever.js";
import { DeepSeekGroundedRanker } from "./infrastructure/llm/grounded-ranker.js";
import path from "node:path";
import { ScientificService } from "./application/scientific-service.js";
import { ScientificDispatcher } from "./application/scientific-dispatcher.js";
import {
  LocalPythonWorker,
  nodeScientificCodeVersion,
} from "./infrastructure/scientific/local-python-worker.js";
import { CsvService } from "./application/csv-service.js";
import { EvidenceService } from "./application/evidence-service.js";
import { LocalEvidenceFileStore } from "./infrastructure/evidence/local-evidence-file-store.js";
import { NodeCsvCodec } from "./infrastructure/csv/node-csv-codec.js";
import {
  createCsvRepository,
  createEvidenceRepository,
  createScientificRepository,
} from "./infrastructure/repositories/storage-adapter.js";
import { AdminService } from "./application/admin-service.js";
import { AIService } from "./application/ai-service.js";
import { AuthService } from "./application/auth-service.js";
import { ClassSummaryService } from "./application/class-summary-service.js";
import { ExperimentService } from "./application/experiment-service.js";
import { ReviewService } from "./application/review-service.js";
import { OperationsService } from "./application/operations-service.js";
import { PracticeService } from "./application/practice-service.js";
import { env } from "./config/env.js";
import { APP_VERSION } from "./config/constants.js";
import { DeepSeekProvider } from "./infrastructure/llm/deepseek-provider.js";
import { JsonPracticeRepository } from "./infrastructure/practice/json-practice-repository.js";
import {
  ensureData,
  storageInfo,
  StorageAuditRepository,
  StorageExperimentRepository,
  StorageLoginAttemptRepository,
  StorageMetricsRepository,
  StorageSessionRepository,
  StorageUserRepository,
} from "./infrastructure/repositories/storage-adapter.js";
import { NodeSecurity } from "./infrastructure/security/node-security.js";
import { createRouter } from "./http/router.js";
import { SlidingWindowRateLimiter } from "./shared/rate-limiter.js";
import { log } from "./shared/logger.js";

await ensureData();

const users = new StorageUserRepository();
const sessions = new StorageSessionRepository();
const attempts = new StorageLoginAttemptRepository();
const records = new StorageExperimentRepository();
const audit = new StorageAuditRepository();
const metrics = new StorageMetricsRepository();
const practice = new JsonPracticeRepository();
const security = new NodeSecurity();
const passwordHasher = security.passwordHasher();
const ai = new AIService(
  new DeepSeekProvider(env),
  new SlidingWindowRateLimiter(env.aiRateWindowMs, env.aiRateMaximum),
  audit,
);
const auth = new AuthService(users, sessions, attempts, audit, passwordHasher, security);
const experiments = new ExperimentService(records, audit, security);
const reviews = new ReviewService(records, records, audit, security);
const admin = new AdminService(users, audit, passwordHasher, security);
const practiceService = new PracticeService(practice, security);
const classSummaries = new ClassSummaryService(experiments, practiceService, ai, audit);
const operations = new OperationsService(metrics, ai, storageInfo.mode);
const csvCodec = new NodeCsvCodec();
const csv = new CsvService(
  createCsvRepository(APP_VERSION),
  csvCodec,
  csvCodec,
  new SlidingWindowRateLimiter(60_000, 10),
);
const evidence = new EvidenceService(
  createEvidenceRepository(APP_VERSION),
  new LocalEvidenceFileStore(storageInfo.dataDir),
  csvCodec,
  new SlidingWindowRateLimiter(60_000, 10),
);

const scientificRepository = createScientificRepository(APP_VERSION);
let scientificWorker: LocalPythonWorker | null = null;
let scientificDispatcher: ScientificDispatcher | null = null;
if (storageInfo.mode === "sqlite" && env.scientificEnabled) {
  scientificWorker = new LocalPythonWorker({
    dataDir: storageInfo.dataDir,
    packageDirectory: path.resolve("analytics/echoclass_analytics"),
    pythonExecutable: env.scientificPython,
  });
  try {
    const identity = await scientificWorker.start();
    scientificDispatcher = new ScientificDispatcher(
      scientificRepository,
      scientificWorker,
      {
        ...identity,
        node_code_version: await nodeScientificCodeVersion(),
        app_version: APP_VERSION,
      },
      (code) => log({ level: "warn", event: "scientific.integrity_blocked", result: code }),
    );
    await scientificDispatcher.start();
  } catch {
    scientificDispatcher = null;
    await scientificWorker.stop();
    log({ level: "warn", event: "scientific.unavailable", result: "worker_start_failed" });
  }
}
const scientific = new ScientificService(
  scientificRepository,
  new SlidingWindowRateLimiter(60_000, 10),
  scientificDispatcher,
);
const documentRetriever = new SqliteDocumentRetriever(
  path.resolve("resources/knowledge/echoclass-guide.md"),
);
const grounded = new GroundedService(
  scientific,
  new SlidingWindowRateLimiter(60_000, 10),
  audit,
  new DeepSeekGroundedRanker({
    enabled: process.env.ECHOCLASS_GROUNDED_AI_ENABLED === "1",
    apiKey: process.env.ECHOCLASS_GROUNDED_AI_KEY ?? "",
    model: process.env.ECHOCLASS_GROUNDED_AI_MODEL ?? "deepseek-v4-flash",
  }),
  documentRetriever,
);

const server = http.createServer(
  createRouter({
    grounded,
    scientific,
    evidence,
    csv,
    auth,
    admin,
    ai,
    experiments,
    reviews,
    classSummaries,
    operations,
    practice: practiceService,
    storageMode: storageInfo.mode,
    demoSeedEnabled: env.seedDemo,
    requestId: () => security.random(12),
  }),
);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    log({
      level: "error",
      event: "server.listen_failed",
      route: String(env.port),
      result: error.code,
    });
    process.exit(1);
  }
  log({ level: "error", event: "server.fatal", result: error.code ?? "unknown" });
  process.exit(1);
});

server.listen(env.port, "0.0.0.0", () => {
  log({
    level: "info",
    event: "server.started",
    route: `http://localhost:${env.port}`,
    result: `${APP_VERSION}:${storageInfo.mode}`,
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  scientificDispatcher?.stop();
  server.close();
  void (async () => {
    await scientificWorker?.stop();
    await scientificDispatcher?.drain();
    server.closeAllConnections();
    documentRetriever.close();
    log({ level: "info", event: "server.stopped", result: signal });
    process.exit(0);
  })();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
