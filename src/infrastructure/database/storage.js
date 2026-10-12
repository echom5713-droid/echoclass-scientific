import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { hashPassword, isPasswordHash, nowIso } from "../security/node-security.js";
import { RepositoryConflictError } from "../../domain/repositories.js";
import { validateExperiment } from "../../domain/experiments/validation.js";
import { DEMO_RECORDS } from "../../shared/demo-records.js";
import { runMigrations } from "./migrations/index.js";
import { SqliteProvenanceStore } from "./sqlite-provenance-store.js";
import { SqliteCsvRepository } from "./sqlite-csv-repository.js";
import { SqliteEvidenceRepository } from "./sqlite-evidence-repository.js";
import { SqliteScientificRepository } from "./sqlite-scientific-repository.js";
import { parseLegacyBoolean } from "./migrations/002-legacy-preflight.js";
import { isStrictTimestamp } from "../../shared/strict-timestamp.js";
import { assertJsonSafeObject } from "../../shared/json-safe.js";
import { machineIdentity } from "../../shared/provenance-contract.js";

const DATA_DIR = process.env.ECHOCLASS_DATA_DIR
  ? path.resolve(process.env.ECHOCLASS_DATA_DIR)
  : path.join(process.cwd(), "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const DB_FILE = path.join(DATA_DIR, "citrus.db");
const WANT_JSON =
  String(process.env.STORAGE_MODE || "").toLowerCase() === "json";
const SESSION_MS = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const DEMO_SEED_ENABLED = process.env.ECHOCLASS_SEED_DEMO === "1";

let db = null;
let provenanceStore = null;
let writeQueue = Promise.resolve();
export function createCsvRepository(appVersion) {
  return new SqliteCsvRepository(db, appVersion);
}
export function createEvidenceRepository(appVersion) {
  return new SqliteEvidenceRepository(db, appVersion);
}
export function createScientificRepository(appVersion) {
  return new SqliteScientificRepository(db, appVersion);
}
const memorySessions = new Map();

export const storageInfo = {
  mode: "initializing",
  dataDir: DATA_DIR,
  recordsFile: RECORDS_FILE,
  usersFile: USERS_FILE,
  dbFile: DB_FILE,
  note: "默认使用 SQLite；仅显式 STORAGE_MODE=json 时启用有限兼容模式。",
};

function defaultUsers() {
  return DEMO_SEED_ENABLED ? [
    {
      id: "demo-student-001",
      role: "student",
      username: "student001",
      passwordHash: hashPassword("123456"),
      defaultPassword: true,
      name: "演示学生 01",
      class_name: "演示化学班",
      group_name: "演示 3 组",
      status: "demo",
      created_at: nowIso(),
    },
    {
      id: "demo-student-002",
      role: "student",
      username: "student002",
      passwordHash: hashPassword("123456"),
      defaultPassword: true,
      name: "演示学生 02",
      class_name: "演示化学班",
      group_name: "演示 2 组",
      status: "demo",
      created_at: nowIso(),
    },
    {
      id: "demo-student-003",
      role: "student",
      username: "student003",
      passwordHash: hashPassword("123456"),
      defaultPassword: true,
      name: "演示学生 03",
      class_name: "演示化学班",
      group_name: "演示 1 组",
      status: "demo",
      created_at: nowIso(),
    },
    {
      id: "demo-teacher-001",
      role: "teacher",
      username: "teacher001",
      passwordHash: hashPassword("123456"),
      defaultPassword: true,
      name: "演示教师",
      class_name: "演示化学班",
      status: "demo",
      created_at: nowIso(),
    },
    {
      id: "demo-admin-001",
      role: "admin",
      username: "admin",
      passwordHash: hashPassword("123456"),
      defaultPassword: true,
      name: "演示管理员",
      status: "demo",
      created_at: nowIso(),
    },
  ] : [];
}

function defaultRecords() {
  return DEMO_SEED_ENABLED ? DEMO_RECORDS : [];
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    const val = JSON.parse(raw);
    return val ?? fallback;
  } catch {
    return fallback;
  }
}

async function readJsonArrayForImport(file, fallback) {
  const raw = existsSync(file) ? await readFile(file, "utf8") : JSON.stringify(fallback);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON import source is malformed: ${path.basename(file)}`);
  }
  if (!Array.isArray(parsed))
    throw new Error(`JSON import source must be an array: ${path.basename(file)}`);
  return parsed;
}

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return { ...value };
}

function importIdentifier(value, label) {
  return machineIdentity(value, label);
}

function importTimestamp(value, label, fallback, metadata) {
  if (value === undefined || value === null || value === "") {
    metadata[`${label}_source`] = "import_time_missing_legacy_value";
    return fallback;
  }
  if (
    !isStrictTimestamp(value)
  )
    throw new Error(`${label} must be a valid timestamp`);
  return value;
}

function importProvenanceKind(value, label) {
  if (value === undefined || value === null || value === "") return "legacy_projection";
  if (value === "human" || value === "legacy_projection") return value;
  throw new Error(`${label} is unsupported`);
}

function importedUser(source, importedAt) {
  const raw = jsonObject(source, "Imported user");
  const metadata =
    raw.import_metadata &&
    typeof raw.import_metadata === "object" &&
    !Array.isArray(raw.import_metadata)
      ? { ...raw.import_metadata }
      : {};
  const prepared = sanitizeUserForStorage({
    ...raw,
    id: importIdentifier(raw.id, "Imported user id"),
    created_at: importTimestamp(raw.created_at, "user_created_at", importedAt, metadata),
    import_metadata: metadata,
  });
  for (const field of ["updated_at", "password_changed_at", "password_reset_at"]) {
    if (raw[field] !== undefined && raw[field] !== null && raw[field] !== "")
      prepared[field] = importTimestamp(raw[field], `user_${field}`, importedAt, metadata);
  }
  const createdAt = Date.parse(prepared.created_at);
  for (const field of ["updated_at", "password_changed_at", "password_reset_at"]) {
    if (prepared[field] && Date.parse(prepared[field]) < createdAt)
      throw new Error(`Imported user ${prepared.id} ${field} predates created_at`);
  }
  return prepared;
}

function canonicalRecordFromCommand(command) {
  machineIdentity(command.id, "experiment record id");
  if (command.client_submission_id !== undefined)
    machineIdentity(command.client_submission_id, "client submission id");
  if (command.created_by_user_id !== undefined)
    machineIdentity(command.created_by_user_id, "experiment creator id");
  assertJsonSafeObject(command.metadata, "experiment metadata");
  const suppliedStatus = command.initial_quality_status || command.review_status || "normal";
  if (
    !["normal", "review"].includes(suppliedStatus) ||
    command.effective_review_id ||
    command.review_note ||
    command.reviewed_by ||
    command.reviewed_at
  )
    throw new Error("Canonical creation cannot set a human review projection");
  const findings = validateExperiment(command);
  if (findings.length)
    throw new Error(
      `Invalid canonical experiment: ${findings.map((finding) => finding.field).join(", ")}`,
    );
  return {
    ...command,
    status: "active",
    yield_percent: Number(((command.oil_mass / command.peel_mass) * 100).toFixed(2)),
    updated_at: command.created_at,
    review_status: suppliedStatus,
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    ai_diagnosis: command.ai_diagnosis || "",
    measurement_method: command.measurement_method || "not_recorded",
    metadata: { ...command.metadata },
  };
}

function importedRecord(source, importedAt, importedUsers) {
  const raw = jsonObject(source, "Imported record");
  const metadata =
    raw.metadata === undefined || raw.metadata === null
      ? {}
      : jsonObject(raw.metadata, `Imported record ${String(raw.id || "unknown")} metadata`);
  const history = Array.isArray(metadata.review_history)
    ? metadata.review_history
    : Array.isArray(raw.review_history)
      ? raw.review_history
      : [];
  delete metadata.review_history;
  if (raw.yield_percent !== undefined)
    metadata.legacy_reported_yield_percent = raw.yield_percent;
  const anomaly = parseLegacyBoolean(raw.异常标记);
  const submittedValues = {
    student_name: raw.student_name,
    class_name: raw.class_name,
    group_name: raw.group_name || "",
    nh4cl_concentration: raw.nh4cl_concentration,
    peel_mass: raw.peel_mass,
    oil_mass: raw.oil_mass,
    distillation_time: raw.distillation_time,
    phase_clarity_score: raw.phase_clarity_score,
    emulsification_level: raw.emulsification_level,
    emulsion_concentration: raw.emulsion_concentration,
    ecoli_observation_group: raw.ecoli_observation_group,
    inhibition_zone_diameter: raw.inhibition_zone_diameter,
    colony_growth_score: raw.colony_growth_score,
    异常标记: anomaly,
    error_source: raw.error_source || "",
    note: raw.note || "",
    experiment_date: raw.experiment_date,
    petri_diameter_mm: raw.petri_diameter_mm,
    measurement_method: raw.measurement_method || "not_recorded",
  };
  const findings = validateExperiment(submittedValues);
  if (findings.length)
    throw new Error(
      `Invalid imported experiment ${String(raw.id || "unknown")}: ${findings
        .map((finding) => finding.field)
        .join(", ")}`,
    );
  const recordId = importIdentifier(raw.id, "Imported record id");
  const creatorId =
    raw.created_by_user_id === undefined || raw.created_by_user_id === null
      ? undefined
      : importIdentifier(raw.created_by_user_id, `Imported record ${recordId} creator id`);
  const importedCreator = creatorId ? importedUsers.get(creatorId) : undefined;
  let creator;
  let resolvedCreatorId;
  if (raw.created_by !== undefined && raw.created_by !== null && raw.created_by !== "") {
    if (typeof raw.created_by !== "string" || !raw.created_by.trim())
      throw new Error(`Imported record ${recordId} creator label is invalid`);
    creator = raw.created_by.trim();
    resolvedCreatorId = importedCreator ? creatorId : undefined;
    metadata.created_by_label_source = "explicit_creator_label";
    if (creatorId && !importedCreator)
      metadata.created_by_user_reference = "unresolved_creator_reference";
  } else if (importedCreator) {
    creator = String(importedCreator.name || importedCreator.username);
    resolvedCreatorId = creatorId;
    metadata.created_by_label_source = "derived_from_imported_user";
  } else if (creatorId) {
    creator = "legacy-unknown";
    resolvedCreatorId = undefined;
    metadata.created_by_label_source = "unresolved_creator_reference";
  } else {
    creator = "legacy-unknown";
    resolvedCreatorId = undefined;
    metadata.created_by_label_source = "explicit_legacy_unknown";
  }
  const clientSubmissionId =
    raw.client_submission_id === undefined || raw.client_submission_id === null
      ? undefined
      : importIdentifier(
          raw.client_submission_id,
          `Imported record ${recordId} client submission id`,
        );
  const createdAt = importTimestamp(raw.created_at, "created_at", importedAt, metadata);
  const updatedAt = importTimestamp(raw.updated_at, "updated_at", createdAt, metadata);
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new Error(`Imported record ${recordId} updated_at predates created_at`);
  const command = canonicalRecordFromCommand({
    ...submittedValues,
    id: recordId,
    client_submission_id: clientSubmissionId,
    created_by_user_id: resolvedCreatorId,
    created_by: creator,
    created_at: createdAt,
    initial_quality_status: raw.review_status === "review" ? "review" : "normal",
    synced_from_offline: parseLegacyBoolean(raw.synced_from_offline),
    metadata,
  });
  const reviews = history.map((item, index) => {
    const event = jsonObject(item, `Review history ${command.id}:${index}`);
    if (!event.id || !["review", "included", "excluded"].includes(event.status))
      throw new Error(`Invalid review history event for ${command.id}`);
    const reviewId = importIdentifier(event.id, `Review history ${command.id}:${index} id`);
    let reviewerUserId;
    if (
      event.reviewer_user_id !== undefined &&
      event.reviewer_user_id !== null &&
      event.reviewer_user_id !== ""
    ) {
      reviewerUserId = importIdentifier(
        event.reviewer_user_id,
        `Review history ${command.id}:${index} reviewer id`,
      );
      if (!importedUsers.has(reviewerUserId))
        throw new Error(`Review history ${command.id}:${index} reviewer reference is unresolved`);
    }
    return {
      id: reviewId,
      record_id: command.id,
      reviewer_user_id: reviewerUserId,
      status: event.status,
      note: String(event.note || ""),
      reviewed_by: String(event.reviewed_by || ""),
      reviewed_at: event.reviewed_at
        ? importTimestamp(event.reviewed_at, "reviewed_at", importedAt, metadata)
        : "",
      created_at: importTimestamp(event.created_at, "review_created_at", importedAt, metadata),
      provenance_kind: importProvenanceKind(
        event.provenance_kind,
        `Review history ${command.id}:${index} provenance_kind`,
      ),
    };
  });
  if (
    reviews.length === 0 &&
    ["included", "excluded"].includes(String(raw.review_status))
  ) {
    const projectionReviewerId =
      raw.reviewer_user_id === undefined ||
      raw.reviewer_user_id === null ||
      raw.reviewer_user_id === ""
        ? undefined
        : importIdentifier(raw.reviewer_user_id, `Imported record ${command.id} reviewer id`);
    if (projectionReviewerId && !importedUsers.has(projectionReviewerId))
      throw new Error(`Imported record ${command.id} reviewer reference is unresolved`);
    const projectionReviewedAt = raw.reviewed_at
      ? importTimestamp(raw.reviewed_at, "projection_reviewed_at", importedAt, metadata)
      : importedAt;
    if (!raw.reviewed_at)
      metadata.legacy_projection_reviewed_at_source =
        "import_capture_time_missing_historical_review_time";
    reviews.push({
      id: `legacy-import-review-${command.id}`,
      record_id: command.id,
      reviewer_user_id: projectionReviewerId,
      status: raw.review_status,
      note: String(raw.review_note || ""),
      reviewed_by: String(raw.reviewed_by || ""),
      reviewed_at: projectionReviewedAt,
      created_at: projectionReviewedAt,
      provenance_kind: "legacy_projection",
    });
  }
  let priorReviewAt = createdAt;
  for (const event of reviews) {
    if (Date.parse(event.created_at) < Date.parse(createdAt))
      throw new Error(`Imported review ${event.id} predates its record`);
    if (Date.parse(event.created_at) < Date.parse(priorReviewAt))
      throw new Error(`Imported review ${event.id} violates review chronology`);
    if (event.reviewed_at && Date.parse(event.reviewed_at) < Date.parse(event.created_at))
      throw new Error(`Imported review ${event.id} reviewed_at predates created_at`);
    priorReviewAt = event.created_at;
  }
  return { command, reviews, updatedAt };
}

function atomicWrite(file, value) {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const next = typeof value === "function" ? await value() : value;
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, file);
  });
  return writeQueue;
}

function sanitizeUserForStorage(user) {
  const next = { ...user };
  if (next.password && !next.passwordHash) {
    next.passwordHash = hashPassword(next.password);
    delete next.password;
  }
  if (next.passwordHash && !isPasswordHash(next.passwordHash)) {
    next.passwordHash = hashPassword(String(next.passwordHash));
  }
  delete next.passwordSalt;
  if (!next.id)
    next.id = `${next.role || "user"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!next.status) next.status = "active";
  return next;
}

function j(value) {
  return JSON.stringify(value ?? {});
}
function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function setupSqlite() {
  const sqlite = await import("node:sqlite");
  db = new sqlite.DatabaseSync(DB_FILE);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 5000;",
  );
  runMigrations(db);
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
  if (!foreignKeys || Number(foreignKeys.foreign_keys) !== 1)
    throw new Error("SQLite foreign-key enforcement is disabled");
  const recursiveTriggers = db.prepare("PRAGMA recursive_triggers").get();
  if (!recursiveTriggers || Number(recursiveTriggers.recursive_triggers) !== 1)
    throw new Error("SQLite recursive-trigger enforcement is disabled");
  provenanceStore = new SqliteProvenanceStore(db);
}

function insertUser(user) {
  const u = sanitizeUserForStorage(user);
  db.prepare(
    `INSERT INTO users(
      id,role,username,password_hash,default_password,name,class_name,group_name,
      status,data_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      role=excluded.role,
      username=excluded.username,
      password_hash=excluded.password_hash,
      default_password=excluded.default_password,
      name=excluded.name,
      class_name=excluded.class_name,
      group_name=excluded.group_name,
      status=excluded.status,
      data_json=excluded.data_json,
      updated_at=excluded.updated_at`,
  ).run(
    u.id,
    u.role,
    u.username,
    u.passwordHash,
    u.defaultPassword ? 1 : 0,
    u.name || u.username,
    u.class_name || "",
    u.group_name || "",
    u.status || "active",
    j(u),
    u.created_at || nowIso(),
    u.updated_at || null,
  );
  if (u.class_name) {
    db.prepare(
      "INSERT OR IGNORE INTO classes(id,name,teacher_id,created_at) VALUES(?,?,?,?)",
    ).run(
      `class-${Buffer.from(u.class_name).toString("hex").slice(0, 24)}`,
      u.class_name,
      u.role === "teacher" ? u.id : null,
      nowIso(),
    );
  }
}

function importRecord(record) {
  if (!provenanceStore) throw new Error("SQLite provenance store is unavailable");
  provenanceStore.importExperiment(record);
}

async function seedSqliteFromJsonIfEmpty() {
  const importId = "json-startup-v1";
  if (db.prepare("SELECT 1 FROM storage_imports WHERE id=?").get(importId)) return;
  const beforeUsers = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
  const beforeRecords = Number(
    db.prepare("SELECT COUNT(*) AS c FROM experiment_records").get().c,
  );
  if (beforeUsers > 0 || beforeRecords > 0) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 FROM storage_imports WHERE id=?").get(importId)) {
        const currentUsers = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
        const currentRecords = Number(
          db.prepare("SELECT COUNT(*) AS c FROM experiment_records").get().c,
        );
        if (currentUsers > 0 || currentRecords > 0)
          db.prepare(
            `INSERT INTO storage_imports(
              id, source_kind, source_user_count, source_record_count,
              target_user_count, target_record_count, disposition, completed_at
            ) VALUES(?, 'startup_json_snapshot', 0, 0, ?, ?,
              'existing_sqlite_authoritative', ?)`,
          ).run(importId, currentUsers, currentRecords, nowIso());
      }
      db.exec("COMMIT");
      return;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original import-marker failure.
      }
      throw error;
    }
  }
  const importedAt = nowIso();
  const sourceUsers = await readJsonArrayForImport(USERS_FILE, defaultUsers());
  const seenUserIds = new Set();
  for (const source of sourceUsers) {
    const raw = jsonObject(source, "Imported user");
    const id = importIdentifier(raw.id, "Imported user id");
    if (seenUserIds.has(id)) throw new Error(`Duplicate imported user id: ${id}`);
    seenUserIds.add(id);
  }
  const users = sourceUsers.map((source) => importedUser(source, importedAt));
  for (const user of users) {
    if (
      !user.id ||
      !user.username ||
      !user.name ||
      !["student", "teacher", "admin"].includes(user.role) ||
      !isPasswordHash(user.passwordHash)
    )
      throw new Error("JSON user import preflight failed");
  }
  const sourceRecords = await readJsonArrayForImport(RECORDS_FILE, defaultRecords());
  const importedUsers = new Map(users.map((user) => [user.id, user]));
  const prepared = sourceRecords.map((source) => importedRecord(source, importedAt, importedUsers));
  const recordIds = new Set();
  const reviewIds = new Set();
  for (const item of prepared) {
    if (recordIds.has(item.command.id))
      throw new Error(`Duplicate imported record id: ${item.command.id}`);
    recordIds.add(item.command.id);
    for (const review of item.reviews) {
      if (reviewIds.has(review.id)) throw new Error(`Duplicate imported review id: ${review.id}`);
      reviewIds.add(review.id);
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM storage_imports WHERE id=?").get(importId)) {
      db.exec("COMMIT");
      return;
    }
    const concurrentUsers = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
    const concurrentRecords = Number(
      db.prepare("SELECT COUNT(*) AS c FROM experiment_records").get().c,
    );
    if (concurrentUsers > 0 || concurrentRecords > 0) {
      db.prepare(
        `INSERT INTO storage_imports(
          id, source_kind, source_user_count, source_record_count,
          target_user_count, target_record_count, disposition, completed_at
        ) VALUES(?, 'startup_json_snapshot', 0, 0, ?, ?,
          'existing_sqlite_authoritative', ?)`,
      ).run(importId, concurrentUsers, concurrentRecords, nowIso());
      db.exec("COMMIT");
      return;
    }
    db.prepare(
      `INSERT INTO legacy_import_batches(
        id,source_kind,source_user_count,source_record_count,opened_at
      ) VALUES(?,'startup_json_snapshot',?,?,?)`,
    ).run(importId, users.length, prepared.length, importedAt);
    for (const user of users) insertUser(user);
    for (const item of prepared) {
      if (
        item.command.created_by_user_id &&
        !db.prepare("SELECT 1 FROM users WHERE id=?").get(item.command.created_by_user_id)
      )
        throw new Error(`Imported record ${item.command.id} creator reference is unresolved`);
      if (item.command.client_submission_id && !item.command.created_by_user_id) {
        item.command.metadata.legacy_unscoped_client_submission_id =
          item.command.client_submission_id;
        item.command.metadata.legacy_idempotency_scope =
          "unresolved_actor_no_durable_guarantee";
        item.command.client_submission_id = undefined;
      }
      importRecord({
        ...item.command,
        storage_import_id: importId,
        updated_at: item.updatedAt,
      });
      for (const review of item.reviews) {
        if (
          review.reviewer_user_id &&
          !db.prepare("SELECT 1 FROM users WHERE id=?").get(review.reviewer_user_id)
        )
          throw new Error(`Imported review ${review.id} reviewer reference is unresolved`);
        provenanceStore.importReview(review);
      }
    }
    const importedUsers = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
    const importedRecords = Number(
      db.prepare("SELECT COUNT(*) AS c FROM experiment_records").get().c,
    );
    if (importedUsers !== users.length || importedRecords !== prepared.length)
      throw new Error("JSON startup import count verification failed");
    const targetUsers = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
    const targetRecords = Number(
      db.prepare("SELECT COUNT(*) AS c FROM experiment_records").get().c,
    );
    db.prepare(
      `INSERT INTO storage_imports(
        id, source_kind, source_user_count, source_record_count,
        target_user_count, target_record_count, disposition, completed_at
      ) VALUES(?, 'startup_json_snapshot', ?, ?, ?, ?, ?, ?)`,
    ).run(
      importId,
      users.length,
      prepared.length,
      targetUsers,
      targetRecords,
      "imported",
      importedAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original import failure.
    }
    throw error;
  }
}

export async function ensureData() {
  if (existsSync(path.join(DATA_DIR, "RESTORE_IN_PROGRESS")))
    throw new Error("Restore is incomplete; refuse to start with this data directory");
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(RECORDS_FILE)) await atomicWrite(RECORDS_FILE, defaultRecords());
  if (!existsSync(USERS_FILE)) await atomicWrite(USERS_FILE, defaultUsers());
  if (WANT_JSON) {
    db = null;
    provenanceStore = null;
    storageInfo.mode = "local-json-adapter";
    storageInfo.note = "显式 JSON 兼容模式；不提供 SQLite 迁移、事务或约束保证。";
    await readUsers();
    return;
  }
  await setupSqlite();
  await seedSqliteFromJsonIfEmpty();
  storageInfo.mode = "sqlite";
  storageInfo.note = "SQLite 规范化科学数据与追加式评审持久化已启用。";
}

export async function readRecords(options = {}) {
  if (db) return provenanceStore.findAll(options);
  const records = await readJson(RECORDS_FILE, []);
  let out = Array.isArray(records) ? records : [];
  out.forEach((record, index) => {
    const id = machineIdentity(record?.id, `experiment record ${index} id`);
    if (record.client_submission_id !== undefined && record.client_submission_id !== null)
      machineIdentity(record.client_submission_id, `experiment record ${id} client submission id`);
    assertJsonSafeObject(record.metadata, `experiment record ${id} metadata`);
  });
  if (!options.includeDeleted) out = out.filter((record) => record.status !== "deleted");
  if (options.class_name && !options.includeAll)
    out = out.filter((r) => r.class_name === options.class_name);
  return out;
}

export async function findRecordByIdIncludingDeleted(recordId) {
  if (db) return provenanceStore.findByIdIncludingDeleted(recordId);
  return (
    (await readRecords({ includeAll: true, includeDeleted: true })).find(
      (record) => String(record.id) === String(recordId),
    ) || null
  );
}

export async function findRecordById(recordId) {
  if (db) return provenanceStore.findById(recordId);
  return (
    (await readRecords({ includeAll: true })).find(
      (record) => String(record.id) === String(recordId),
    ) || null
  );
}

export async function findRecordByClientSubmission({
  actorId,
  className,
  clientSubmissionId,
}) {
  if (db)
    return provenanceStore.findByClientSubmission({ actorId, className, clientSubmissionId });
  return (
    (await readRecords({ class_name: className })).find(
      (record) =>
        record.metadata?.idempotency_actor_id === actorId &&
        record.metadata?.idempotency_class_name === className &&
        record.metadata?.client_submission_id === clientSubmissionId,
    ) || null
  );
}

export async function saveRecords(records) {
  if (db) {
    throw new Error("Bulk replacement of scientific records is not supported");
  }
  const safeRecords = Array.isArray(records) ? records : [];
  safeRecords.forEach((record, index) =>
    assertJsonSafeObject(
      record?.metadata,
      `experiment record ${String(record?.id ?? index)} metadata`,
    ),
  );
  await atomicWrite(RECORDS_FILE, safeRecords);
}
export async function addRecord(record) {
  if (db) {
    provenanceStore.add(record);
    return;
  }
  const canonical = canonicalRecordFromCommand(record);
  const { initial_quality_status: _quality, ...stored } = canonical;
  const records = await readRecords();
  if (records.some((item) => String(item.id) === String(stored.id)))
    throw new RepositoryConflictError();
  records.unshift(stored);
  await saveRecords(records);
}

export async function updateRecord(recordId, patch = {}) {
  if (db) return provenanceStore.update(recordId, patch);
  const records = await readRecords({ includeAll: true });
  const idx = records.findIndex((r) => String(r.id) === String(recordId));
  if (idx < 0) return null;
  const allowed = new Set([
    "class_name", "group_name", "nh4cl_concentration", "peel_mass", "oil_mass",
    "distillation_time", "phase_clarity_score", "emulsification_level",
    "emulsion_concentration", "ecoli_observation_group", "inhibition_zone_diameter",
    "colony_growth_score", "异常标记", "error_source", "note", "experiment_date",
    "petri_diameter_mm", "measurement_method",
  ]);
  for (const field of Object.keys(patch)) {
    if (!allowed.has(field)) throw new Error(`Protected experiment update field: ${field}`);
  }
  const merged = {
    ...records[idx],
    ...patch,
    yield_percent: Number(
      (((patch.oil_mass ?? records[idx].oil_mass) /
        (patch.peel_mass ?? records[idx].peel_mass)) *
        100).toFixed(2),
    ),
    updated_at: nowIso(),
  };
  const findings = validateExperiment(merged);
  if (findings.length)
    throw new Error(
      `Invalid experiment correction: ${findings.map((finding) => finding.field).join(", ")}`,
    );
  records[idx] = merged;
  const allRecords = await readJson(RECORDS_FILE, []);
  const allIndex = allRecords.findIndex((record) => String(record.id) === String(recordId));
  allRecords[allIndex] = merged;
  await saveRecords(allRecords);
  return records[idx];
}

export async function deleteRecord(recordId) {
  if (db) return provenanceStore.delete(recordId);
  const records = await readJson(RECORDS_FILE, []);
  const index = records.findIndex(
    (record) => String(record.id) === String(recordId) && record.status !== "deleted",
  );
  if (index < 0) return false;
  records[index] = { ...records[index], status: "deleted", updated_at: nowIso() };
  await saveRecords(records);
  return true;
}

export async function appendRecordReview(command) {
  if (db) return provenanceStore.appendReview(command);
  machineIdentity(command.record_id, "review record id");
  machineIdentity(command.reviewer_user_id, "reviewer user id");
  const timestamp = nowIso();
  const review = {
    ...command,
    id: `review-${randomBytes(16).toString("hex")}`,
    reviewed_at: timestamp,
    created_at: timestamp,
    provenance_kind: "human",
  };
  const records = await readRecords({ includeAll: true });
  const index = records.findIndex((record) => String(record.id) === String(review.record_id));
  if (index < 0) return null;
  const current = records[index];
  const history = Array.isArray(current.metadata?.review_history)
    ? current.metadata.review_history
    : [];
  records[index] = {
    ...current,
    review_status: review.status,
    review_note: review.note,
    reviewed_at: review.reviewed_at,
    reviewed_by: review.reviewed_by,
    metadata: { ...current.metadata, review_history: [...history, review] },
    updated_at: review.created_at,
  };
  await saveRecords(records);
  return records[index];
}

export async function readReviewHistory(recordId) {
  if (db) return provenanceStore.listReviewHistory(recordId);
  const record = (await readRecords({ includeAll: true })).find(
    (item) => String(item.id) === String(recordId),
  );
  const history = Array.isArray(record?.metadata?.review_history)
    ? record.metadata.review_history
    : [];
  history.forEach((review, index) => {
    machineIdentity(review?.id, `review history ${recordId}:${index} id`);
    machineIdentity(review?.record_id, `review history ${recordId}:${index} record id`);
    if (review.reviewer_user_id !== undefined && review.reviewer_user_id !== null)
      machineIdentity(
        review.reviewer_user_id,
        `review history ${recordId}:${index} reviewer id`,
      );
  });
  return history;
}

export async function readEffectiveReview(recordId) {
  if (db) return provenanceStore.getEffectiveReview(recordId);
  const history = await readReviewHistory(recordId);
  return history.at(-1) || null;
}

export async function createAnalysisRun(run, inputs) {
  if (!db)
    throw new Error("Analysis provenance requires SQLite; JSON compatibility mode is unsupported");
  provenanceStore.createAnalysisRun(run, inputs);
}

export async function findAnalysisRun(runId) {
  if (!db) return null;
  return provenanceStore.findAnalysisRun(runId);
}

export async function updateAnalysisRunState(runId, update) {
  if (!db) return null;
  return provenanceStore.updateAnalysisRunState(runId, update);
}

export async function readAnalysisInputs(runId) {
  if (!db) return [];
  return provenanceStore.listAnalysisInputs(runId);
}

export async function readUsers(options = {}) {
  if (db) {
    let rows;
    if (options.class_name && !options.includeAll)
      rows = db
        .prepare(
          "SELECT * FROM users WHERE class_name = ? ORDER BY role, username",
        )
        .all(options.class_name);
    else rows = db.prepare("SELECT * FROM users ORDER BY role, username").all();
    return rows.map(userFromRow);
  }
  const raw = await readJson(USERS_FILE, defaultUsers());
  let users = Array.isArray(raw) ? raw : defaultUsers();
  let changed = false;
  users = users.map((user) => {
    const next = sanitizeUserForStorage(user);
    if (JSON.stringify(next) !== JSON.stringify(user)) changed = true;
    return next;
  });
  if (changed) await saveUsers(users);
  if (options.class_name && !options.includeAll)
    users = users.filter((u) => u.class_name === options.class_name);
  return users;
}

function userFromRow(row) {
  return {
    ...parseJson(row.data_json, {}),
    id: row.id,
    role: row.role,
    username: row.username,
    passwordHash: row.password_hash,
    defaultPassword: Boolean(row.default_password),
    name: row.name,
    class_name: row.class_name,
    group_name: row.group_name,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sameSecurityState(current, expected) {
  return current && expected &&
    current.id === expected.id &&
    current.passwordHash === expected.passwordHash &&
    Boolean(current.defaultPassword) === Boolean(expected.defaultPassword) &&
    current.role === expected.role && current.username === expected.username &&
    current.status === expected.status &&
    (current.class_name || "") === (expected.class_name || "") &&
    (current.group_name || "") === (expected.group_name || "");
}

function checkExpectedUsers(current, clean, expectedUsers) {
  if (!expectedUsers) return;
  const live = new Map(current.map((user) => [user.id, user]));
  const expected = new Map(expectedUsers.map((user) => [user.id, user]));
  for (const user of expectedUsers)
    if (!sameSecurityState(live.get(user.id), user)) throw new RepositoryConflictError();
  for (const user of clean)
    if (!expected.has(user.id) && live.has(user.id)) throw new RepositoryConflictError();
}

export async function saveUsers(users, expectedUsers) {
  const clean = (Array.isArray(users) ? users : []).map(sanitizeUserForStorage);
  if (db) {
    db.exec("BEGIN IMMEDIATE");
    try {
      checkExpectedUsers(db.prepare("SELECT * FROM users").all().map(userFromRow), clean, expectedUsers);
      // v212: never DELETE all users during admin create/import.
      // Active sessions have a foreign key to users; deleting rows can make
      // create/import fail while an administrator is logged in.
      for (const u of clean) insertUser(u);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return;
  }
  await atomicWrite(USERS_FILE, async () => {
    checkExpectedUsers(await readJson(USERS_FILE, []), clean, expectedUsers);
    return clean;
  });
}
export async function updateUser(userId, patch) {
  if (db) {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ? OR username = ?")
      .get(userId, userId);
    if (!row) return null;
    const current = {
      ...parseJson(row.data_json, {}),
      id: row.id,
      role: row.role,
      username: row.username,
      passwordHash: row.password_hash,
      defaultPassword: Boolean(row.default_password),
      name: row.name,
      class_name: row.class_name,
      group_name: row.group_name,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    const next = sanitizeUserForStorage({
      ...current,
      ...patch,
      updated_at: nowIso(),
    });
    db.prepare(
      `UPDATE users
      SET role = ?, username = ?, password_hash = ?, default_password = ?, name = ?, class_name = ?, group_name = ?, status = ?, data_json = ?, updated_at = ?
      WHERE id = ?`,
    ).run(
      next.role,
      next.username,
      next.passwordHash,
      next.defaultPassword ? 1 : 0,
      next.name || next.username,
      next.class_name || "",
      next.group_name || "",
      next.status || "active",
      j(next),
      next.updated_at || nowIso(),
      row.id,
    );
    return next;
  }
  const users = await readUsers({ includeAll: true });
  const expectedUsers = users.map((user) => ({...user}));
  const idx = users.findIndex((u) => u.id === userId || u.username === userId);
  if (idx < 0) return null;
  users[idx] = sanitizeUserForStorage({
    ...users[idx],
    ...patch,
    updated_at: nowIso(),
  });
  await saveUsers(users, expectedUsers);
  return users[idx];
}

export async function createSession({
  sidHash,
  user,
  ip,
  ua,
  ttlMs = SESSION_MS,
}) {
  const expiresAt = Date.now() + ttlMs;
  if (db) {
    const inserted = db.prepare(
      `INSERT INTO sessions(sid_hash,user_id,role,ip,ua,created_at,expires_at,revoked_at)
      SELECT ?,id,role,?,?,?, ?,NULL FROM users
      WHERE id=? AND password_hash=? AND default_password=? AND role=? AND username=?
        AND COALESCE(class_name,'')=? AND COALESCE(group_name,'')=? AND status=?
        AND status!='disabled' AND (status!='demo' OR ?=1)`,
    ).run(sidHash, ip || "", ua || "", nowIso(), expiresAt,
      user.id, user.passwordHash, user.defaultPassword ? 1 : 0, user.role, user.username,
      user.class_name || "", user.group_name || "", user.status, DEMO_SEED_ENABLED ? 1 : 0);
    if (Number(inserted.changes) !== 1) throw new RepositoryConflictError();
  } else {
    const current = (await readUsers({ includeAll: true })).find((item) => item.id === user.id);
    if (!sameSecurityState(current, user) || !sessionUserEnabled(current))
      throw new RepositoryConflictError();
    memorySessions.set(sidHash, {
      ...user,
      sidHash,
      expires_at: expiresAt,
      revoked_at: null,
    });
  }
  return { sid_hash: sidHash, user_id: user.id, expires_at: expiresAt };
}

export async function readSession(sidHash) {
  if (!sidHash) return null;
  if (!db) {
    const row = memorySessions.get(sidHash);
    if (!row || row.revoked_at || Date.now() >= Number(row.expires_at))
      return null;
    const current = (await readUsers({ includeAll: true })).find((user) => user.id === row.id);
    if (!sameSecurityState(current, row) || !sessionUserEnabled(current)) return null;
    return safeSession(current, sidHash, row.expires_at);
  }
  const row = db
    .prepare(
      `SELECT s.sid_hash, s.expires_at, s.revoked_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid_hash = ?`,
    )
    .get(sidHash);
  if (!row || row.revoked_at || Date.now() >= Number(row.expires_at) || !sessionUserEnabled(row))
    return null;
  return safeSession(userFromRow(row), sidHash, row.expires_at);
}

function sessionUserEnabled(user) {
  return user && user.status !== "disabled" && (user.status !== "demo" || DEMO_SEED_ENABLED);
}

function safeSession(user, sidHash, expiresAt) {
  return {
    id: user.id, role: user.role, username: user.username, name: user.name,
    class_name: user.class_name || "", group_name: user.group_name || "",
    status: user.status, defaultPassword: Boolean(user.defaultPassword),
    sidHash, expires_at: expiresAt,
  };
}

export async function changeUserPassword({userId, sidHash, expectedPasswordHash, passwordHash, changedAt}) {
  if (db) {
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
    if (!row) return false;
    const next = {...userFromRow(row), passwordHash, defaultPassword:false, password_changed_at:changedAt, updated_at:changedAt};
    const changed = db.prepare(`UPDATE users SET password_hash=?,default_password=0,data_json=?,updated_at=?
      WHERE id=? AND password_hash=? AND status!='disabled'
      AND (status!='demo' OR ?=1)
      AND EXISTS(SELECT 1 FROM sessions WHERE sid_hash=? AND user_id=users.id
        AND revoked_at IS NULL AND expires_at>?)`).run(
      passwordHash,j(next),changedAt,userId,expectedPasswordHash,DEMO_SEED_ENABLED ? 1 : 0,sidHash,Date.now());
    return Number(changed.changes) === 1;
  }
  try {
    await atomicWrite(USERS_FILE, async () => {
      const users = await readJson(USERS_FILE, []);
      const index = users.findIndex((user) => user.id === userId);
      const user = users[index], session = memorySessions.get(sidHash);
      if (!user || user.passwordHash !== expectedPasswordHash || !sessionUserEnabled(user) ||
        !session || session.id !== userId || session.revoked_at || Date.now() >= session.expires_at ||
        !sameSecurityState(user, session)) throw new RepositoryConflictError();
      users[index] = {...user,passwordHash,defaultPassword:false,password_changed_at:changedAt,updated_at:changedAt};
      return users;
    });
    return true;
  } catch (error) {
    if (error instanceof RepositoryConflictError) return false;
    throw error;
  }
}

export async function revokeSession(sidHash) {
  if (db && sidHash)
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE sid_hash = ?").run(
      nowIso(),
      sidHash,
    );
  if (!db && sidHash) memorySessions.delete(sidHash);
}

export async function updateSessionForUser(userId) {
  // Session rows join users at read time, so no snapshot update is needed.
  return Boolean(userId);
}

export async function checkLoginRateLimit({ key }) {
  const now = Date.now();
  if (db) {
    const item = db
      .prepare("SELECT * FROM login_attempts WHERE attempt_key = ?")
      .get(key);
    if (item?.locked_until_ms && now < Number(item.locked_until_ms))
      return {
        ok: false,
        retryAfter: Math.ceil((Number(item.locked_until_ms) - now) / 1000),
      };
    if (item && now - Number(item.first_at_ms) > LOGIN_WINDOW_MS) {
      db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").run(key);
    }
  }
  return { ok: true };
}

export async function registerLoginFailure({ key, ip, username, route }) {
  const now = Date.now();
  if (!db) return;
  const item = db
    .prepare("SELECT * FROM login_attempts WHERE attempt_key = ?")
    .get(key);
  const fresh = !item || now - Number(item.first_at_ms) > LOGIN_WINDOW_MS;
  const count = fresh ? 1 : Number(item.count) + 1;
  const lockedUntil = count >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_WINDOW_MS : 0;
  db.prepare(
    `INSERT OR REPLACE INTO login_attempts(attempt_key,ip,username,route,count,first_at_ms,locked_until_ms,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
  ).run(
    key,
    ip || "",
    username || "",
    route || "",
    count,
    fresh ? now : item.first_at_ms,
    lockedUntil,
    nowIso(),
  );
}

export async function clearLoginFailures(key) {
  if (db)
    db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").run(key);
}

export async function auditLog({
  actor,
  action,
  targetType,
  targetId,
  className,
  ip,
  ua,
  ok = true,
  detail = {},
}) {
  if (!db) return;
  db.prepare(
    `INSERT INTO audit_logs(id,actor_id,actor_role,actor_username,action,target_type,target_id,class_name,ip,ua,ok,detail_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    actor?.id || "",
    actor?.role || "",
    actor?.username || "",
    action,
    targetType || "",
    targetId || "",
    className || actor?.class_name || "",
    ip || "",
    ua || "",
    ok ? 1 : 0,
    j(detail),
    nowIso(),
  );
}

export async function metrics() {
  const mem = process.memoryUsage();
  const base = {
    dbMode: storageInfo.mode,
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    uptime: +process.uptime().toFixed(1),
  };
  if (!db)
    return {
      ...base,
      users: (await readUsers()).length,
      records: (await readRecords()).length,
      sessions: 0,
      auditLogs: 0,
    };
  return {
    ...base,
    users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
    records: db.prepare("SELECT COUNT(*) AS c FROM experiment_records WHERE status='active'").get().c,
    sessions: db
      .prepare(
        "SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > ?",
      )
      .get(Date.now()).c,
    auditLogs: db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get().c,
    loginAttemptRows: db
      .prepare("SELECT COUNT(*) AS c FROM login_attempts")
      .get().c,
  };
}

export function classScopeFor(session, { demo = false } = {}) {
  if (demo) return { includeAll: true, demo: true };
  if (!session) return { class_name: "", includeAll: false };
  if (session.role === "admin") return { includeAll: true };
  return {
    class_name: session.class_name || "高二化学探究班",
    includeAll: false,
  };
}
