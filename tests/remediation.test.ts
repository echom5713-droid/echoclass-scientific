import assert from "node:assert/strict";
import test from "node:test";
import { AdminService, parseImportedUsers } from "../src/application/admin-service.js";
import { AIService } from "../src/application/ai-service.js";
import { ClassSummaryService } from "../src/application/class-summary-service.js";
import { ExperimentService } from "../src/application/experiment-service.js";
import { PracticeService } from "../src/application/practice-service.js";
import { ReviewService } from "../src/application/review-service.js";
import { analyticsFor } from "../src/domain/experiments/analytics.js";
import { RepositoryConflictError } from "../src/domain/repositories.js";
import { parseCreateExperiment } from "../src/http/schemas/experiment.js";
import { parsePasswordChange } from "../src/http/schemas/common.js";
import type {
  AuditRepository,
  ExperimentRepository,
  PracticeRepository,
  ReviewRepository,
  UserRepository,
} from "../src/domain/repositories.js";
import type {
  AuditEvent,
  CreateExperimentCommand,
  ExperimentRecord,
  Session,
  User,
} from "../src/domain/types.js";
import { NodeSecurity } from "../src/infrastructure/security/node-security.js";

const student: Session = {
  id: "student-a",
  role: "student",
  username: "student-a",
  name: "Authenticated Student",
  class_name: "Class A",
  group_name: "Group A",
};

const teacher: Session = {
  id: "teacher-a",
  role: "teacher",
  username: "teacher-a",
  name: "Teacher A",
  class_name: "Class A",
};

const admin: Session = {
  id: "admin",
  role: "admin",
  username: "admin",
  name: "Admin",
  class_name: "",
};

function validInput(overrides: Partial<CreateExperimentCommand> = {}): CreateExperimentCommand {
  return {
    student_name: "Submitted Name",
    class_name: "Class A",
    group_name: "Submitted Group",
    nh4cl_concentration: 3,
    peel_mass: 100,
    oil_mass: 1,
    distillation_time: 45,
    phase_clarity_score: 4,
    emulsification_level: "轻微乳化",
    emulsion_concentration: 20,
    ecoli_observation_group: "精油乳液组",
    inhibition_zone_diameter: 10,
    colony_growth_score: 3,
    异常标记: false,
    error_source: "",
    note: "test",
    ...overrides,
  };
}

function storedRecord(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    ...validInput(),
    id: "record-a",
    yield_percent: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "admin",
    review_status: "normal",
    review_note: "",
    reviewed_at: "",
    reviewed_by: "",
    synced_from_offline: false,
    ai_diagnosis: "",
    metadata: {},
    ...overrides,
  };
}

function memoryRecordRepository(
  initial: ExperimentRecord[] = [],
): ExperimentRepository & ReviewRepository {
  const records = initial;
  const reviews: import("../src/domain/types.js").RecordReview[] = [];
  return {
    findAll: async (scope = {}) =>
      records
        .filter(
          (record) =>
            scope.includeAll || !scope.class_name || record.class_name === scope.class_name,
        )
        .map((record) => structuredClone(record)),
    findById: async (id) => {
      const found = records.find((record) => record.id === id);
      return found ? structuredClone(found) : null;
    },
    findByIdForAudit: async (id) => {
      const found = records.find((record) => record.id === id);
      return found ? structuredClone(found) : null;
    },
    findByClientSubmission: async ({ actorId, className, clientSubmissionId }) => {
      const found = records.find(
        (record) =>
          record.class_name === className &&
          record.metadata?.idempotency_actor_id === actorId &&
          record.metadata?.client_submission_id === clientSubmissionId,
      );
      return found ? structuredClone(found) : null;
    },
    add: async (record) => {
      const canonical = {
        ...record,
        yield_percent: Number(((record.oil_mass / record.peel_mass) * 100).toFixed(2)),
        review_status: record.initial_quality_status || "normal",
        review_note: "",
        reviewed_at: "",
        reviewed_by: "",
        ai_diagnosis: record.ai_diagnosis || "",
      } as ExperimentRecord;
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = structuredClone(canonical);
      else records.push(structuredClone(canonical));
    },
    update: async (id, patch) => {
      const index = records.findIndex((item) => item.id === id);
      const current = records[index];
      if (!current) return null;
      const updated = { ...current, ...patch } as ExperimentRecord;
      records[index] = updated;
      return structuredClone(updated);
    },
    appendReview: async (review) => {
      const index = records.findIndex((item) => item.id === review.record_id);
      const current = records[index];
      if (!current) return null;
      const event: import("../src/domain/types.js").RecordReview = {
        ...review,
        id: `review-${reviews.length + 1}`,
        reviewed_at: "2026-01-02T00:00:00.000Z",
        created_at: "2026-01-02T00:00:00.000Z",
        provenance_kind: "human",
      };
      reviews.push(structuredClone(event));
      const updated = {
        ...current,
        review_status: review.status,
        review_note: review.note,
        reviewed_by: review.reviewed_by,
        reviewed_at: event.reviewed_at,
      };
      records[index] = updated;
      return structuredClone(updated);
    },
    listReviewHistory: async (recordId) =>
      reviews
        .filter((review) => review.record_id === recordId)
        .map((review) => structuredClone(review)),
    getEffectiveReview: async (recordId) =>
      reviews.filter((review) => review.record_id === recordId).at(-1) ?? null,
    delete: async (id) => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
  };
}

const audit: AuditRepository = { write: async () => undefined };
const ids = {
  random: () => `generated-${Math.random().toString(16).slice(2)}`,
  hashSession: (value: string) => value,
};

function localAi(delayMs = 0, events: AuditEvent[] = []): AIService {
  return new AIService(
    {
      status: () => ({
        configured: false,
        provider: "test",
        model: "none",
        base: "https://internal.invalid",
        timeoutMs: 9999,
      }),
      ask: async () => {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return {
          answer: "fallback",
          mode: "local-fallback",
          reason: "deepseek_error",
        };
      },
    },
    { allow: () => true },
    {
      write: async (event) => {
        events.push(event);
      },
    },
  );
}

test("client record IDs cannot replace an existing record", async () => {
  const original = storedRecord({ id: "record-a", class_name: "Class B", note: "immutable" });
  const repository = memoryRecordRepository([structuredClone(original)]);
  const service = new ExperimentService(repository, audit, ids);

  const created = await service.create(
    {
      ...validInput({ student_name: "Attacker", class_name: "Class B" }),
      id: original.id,
    } as unknown as CreateExperimentCommand,
    { actor: student, ip: "127.0.0.1", ua: "test" },
  );

  assert.notEqual(created.record.id, original.id);
  assert.deepEqual(await repository.findById(original.id), original);
});

test("student identity and review fields are server-owned", async () => {
  const repository = memoryRecordRepository();
  const service = new ExperimentService(repository, audit, ids);
  const result = await service.create(
    {
      ...validInput({
        student_name: "Forged Student",
        class_name: "Class B",
        group_name: "Forged Group",
        异常标记: true,
      }),
      review_status: "included",
      review_note: "approved",
      reviewed_by: "admin",
      reviewed_at: "2099-01-01T00:00:00.000Z",
      created_at: "2099-01-01T00:00:00.000Z",
    } as unknown as CreateExperimentCommand,
    { actor: student, ip: "127.0.0.1", ua: "test" },
  );

  assert.equal(result.record.student_name, student.name);
  assert.equal(result.record.class_name, student.class_name);
  assert.equal(result.record.group_name, student.group_name);
  assert.notEqual(result.record.review_status, "included");
  assert.equal(result.record.reviewed_by, "");
  assert.notEqual(result.record.created_at, "2099-01-01T00:00:00.000Z");
  assert.equal(
    analyticsFor([result.record]).validCount,
    0,
    "suspicious unreviewed record must not be client-included",
  );
});

test("ReviewService remains the only review-state writer", async () => {
  const repository = memoryRecordRepository([
    storedRecord({ class_name: "Class A", review_status: "review" }),
  ]);
  const service = new ReviewService(repository, repository, audit, ids);
  const result = await service.apply(teacher, "record-a", "include", "teacher checked", {
    ip: "127.0.0.1",
    ua: "test",
  });
  assert.equal(result.record?.review_status, "included");
  assert.equal(result.record?.reviewed_by, teacher.username);
  await service.apply(teacher, "record-a", "exclude", "second decision", {
    ip: "127.0.0.1",
    ua: "test",
  });
  const history = await service.history(teacher, "record-a");
  assert.equal(history.length, 2);
  assert.equal(history[0]?.status, "included");
  assert.equal(history[1]?.status, "excluded");
  await assert.rejects(
    service.apply(student, "record-a", "include", "forged", { ip: "127.0.0.1", ua: "test" }),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "FORBIDDEN",
  );
  const otherTeacher: Session = { ...teacher, id: "teacher-b", class_name: "Class B" };
  await assert.rejects(
    service.apply(otherTeacher, "record-a", "include", "cross class", {
      ip: "127.0.0.1",
      ua: "test",
    }),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "FORBIDDEN",
  );
  const adminResult = await service.apply(admin, "record-a", "include", "admin decision", {
    ip: "127.0.0.1",
    ua: "test",
  });
  assert.equal(adminResult.record?.review_status, "included");
});

test("scientific transport parsing rejects invalid numbers and missing observations", () => {
  const numericFields = [
    "nh4cl_concentration",
    "peel_mass",
    "oil_mass",
    "distillation_time",
    "phase_clarity_score",
    "emulsion_concentration",
    "inhibition_zone_diameter",
    "colony_growth_score",
  ] as const;
  const base: Record<string, unknown> = { ...validInput() };
  for (const field of numericFields)
    assert.throws(() => parseCreateExperiment({ ...base, [field]: "not-a-number" }), {
      name: "AppError",
    });
  for (const field of numericFields) {
    const missing = { ...base };
    delete missing[field];
    assert.throws(() => parseCreateExperiment(missing), { name: "AppError" });
  }
});

test("scientific booleans parse explicitly and yield remains server-derived", () => {
  const base: Record<string, unknown> = { ...validInput(), peel_mass: 50, oil_mass: 0.5 };
  assert.equal(parseCreateExperiment({ ...base, 异常标记: "false" }).异常标记, false);
  assert.equal(parseCreateExperiment({ ...base, 异常标记: "true" }).异常标记, true);
  assert.throws(() => parseCreateExperiment({ ...base, 异常标记: "sometimes" }), {
    name: "AppError",
  });
  assert.throws(() => parseCreateExperiment({ ...base, yield_percent: 999 }), { name: "AppError" });
});

test("existing-user import without password preserves credentials", async () => {
  const security = new NodeSecurity();
  const oldHash = security.hashPassword("changed-password");
  const users: User[] = [
    {
      id: "u1",
      role: "student",
      username: "student-import",
      passwordHash: oldHash,
      defaultPassword: false,
      name: "Student",
      class_name: "Class A",
      group_name: "Group A",
      status: "active",
      password_reset_at: "2025-01-01T00:00:00.000Z",
    },
  ];
  const repository: UserRepository = {
    findAll: async () => users.map((user) => ({ ...user })),
    findById: async (id) => users.find((user) => user.id === id) ?? null,
    findByUsername: async (username) => users.find((user) => user.username === username) ?? null,
    saveAll: async (next) => {
      users.splice(0, users.length, ...next.map((user) => ({ ...user })));
    },
    update: async () => null,
    changePassword: async () => false,
  };
  const service = new AdminService(repository, audit, security.passwordHasher(), security);
  const parsed = parseImportedUsers("student\tstudent-import\tStudent\tClass A\tGroup A");
  await service.upsert(admin, parsed.users, { ip: "127.0.0.1", ua: "test" });
  assert.equal(users[0]?.passwordHash, oldHash);
  assert.equal(users[0]?.defaultPassword, false);
  assert.equal(users[0]?.password_reset_at, "2025-01-01T00:00:00.000Z");
  assert.equal(security.verify("changed-password", users[0]?.passwordHash ?? ""), true);
  assert.equal(security.verify("123456", users[0]?.passwordHash ?? ""), false);

  await service.upsert(admin, [{ ...parsed.users[0]!, password: "explicit-new-password" }], {
    ip: "127.0.0.1",
    ua: "test",
  });
  assert.equal(security.verify("explicit-new-password", users[0]?.passwordHash ?? ""), true);
});

test("new imported users require an explicit temporary password", async () => {
  const repository: UserRepository = {
    findAll: async () => [],
    findById: async () => null,
    findByUsername: async () => null,
    saveAll: async () => undefined,
    update: async () => null,
    changePassword: async () => false,
  };
  const security = new NodeSecurity();
  const service = new AdminService(repository, audit, security.passwordHasher(), security);
  const parsed = parseImportedUsers("student\tnew-student\tNew Student\tClass A\tGroup A");
  await assert.rejects(
    service.upsert(admin, parsed.users, { ip: "127.0.0.1", ua: "test" }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "VALIDATION_ERROR",
  );
  await assert.rejects(
    service.upsert(admin, [{ ...parsed.users[0]!, password: "123456" }], {
      ip: "127.0.0.1",
      ua: "test",
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "VALIDATION_ERROR",
  );
});

test("administrator reset does not install the fixed demo password", async () => {
  const security = new NodeSecurity();
  const users: User[] = [
    {
      id: "real-user",
      role: "student",
      username: "real-user",
      passwordHash: security.hashPassword("original-password"),
      defaultPassword: false,
      name: "Real User",
      class_name: "Class A",
      group_name: "Group A",
      status: "active",
    },
  ];
  const repository: UserRepository = {
    findAll: async () => users,
    findById: async (id) => users.find((user) => user.id === id) ?? null,
    findByUsername: async (username) => users.find((user) => user.username === username) ?? null,
    saveAll: async () => undefined,
    changePassword: async () => false,
    update: async (id, patch) => {
      const user = users.find((item) => item.id === id);
      if (!user) return null;
      Object.assign(user, patch);
      return user;
    },
  };
  const service = new AdminService(repository, audit, security.passwordHasher(), security);
  const reset = await service.resetPassword(admin, "real-user", {
    ip: "127.0.0.1",
    ua: "test",
  });
  assert.equal(security.verify("123456", users[0]!.passwordHash), false);
  assert.equal(security.verify(reset.temporaryPassword, users[0]!.passwordHash), true);
});

test("password-change transport remains compatible with browser camelCase fields", () => {
  assert.deepEqual(
    parsePasswordChange({ oldPassword: "old-password", newPassword: "new-password" }),
    { oldPassword: "old-password", newPassword: "new-password" },
  );
});

test("record persistence does not wait for or depend on the LLM", async () => {
  const repository = memoryRecordRepository();
  const service = new ExperimentService(repository, audit, ids);
  const started = performance.now();
  const result = await service.create(validInput(), {
    actor: student,
    ip: "127.0.0.1",
    ua: "test",
  });
  const duration = performance.now() - started;
  assert.ok(duration < 100, `record persistence waited ${duration.toFixed(1)}ms for provider`);
  assert.equal((await repository.findById(result.record.id))?.id, result.record.id);
  assert.ok(result.diagnosis);
});

test("duplicate persistence failures map to a safe CONFLICT error", async () => {
  const repository = memoryRecordRepository();
  repository.add = async () => {
    throw new RepositoryConflictError();
  };
  const service = new ExperimentService(repository, audit, ids);
  await assert.rejects(
    service.create(validInput(), { actor: student, ip: "127.0.0.1", ua: "test" }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "CONFLICT" &&
      !String("message" in error ? error.message : "")
        .toLowerCase()
        .includes("sqlite"),
  );
});

test("class-summary AI requests cannot bypass the service rate limiter", async () => {
  let providerCalled = false;
  const ai = new AIService(
    {
      status: () => ({
        configured: true,
        provider: "test",
        model: "test",
        base: "internal",
        timeoutMs: 1,
      }),
      ask: async () => {
        providerCalled = true;
        return { answer: "unexpected", mode: "deepseek-proxy" };
      },
    },
    { allow: () => false },
    audit,
  );
  const experiments = new ExperimentService(memoryRecordRepository(), audit, ids);
  const practiceRepository: PracticeRepository = {
    findAll: async () => [],
    add: async () => undefined,
  };
  const practice = new PracticeService(practiceRepository, ids);
  const summaries = new ClassSummaryService(experiments, practice, ai, audit);
  await assert.rejects(
    summaries.generate(teacher, { ip: "127.0.0.1", ua: "test" }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "RATE_LIMITED",
  );
  assert.equal(providerCalled, false);
});

test("AI fallback audit records provider outcome accurately", async () => {
  const events: AuditEvent[] = [];
  const service = localAi(0, events);
  const result = await service.ask(
    { question: "test question", scene: "review", history: [] },
    student,
    { ip: "127.0.0.1", ua: "test" },
  );
  assert.equal(result.mode, "local-fallback");
  assert.equal(events[0]?.ok, false);
  assert.equal(events[0]?.detail?.mode, "local-fallback");
  assert.equal(events[0]?.detail?.reason, "deepseek_error");
});
