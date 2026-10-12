import assert from "node:assert/strict";
import test from "node:test";
import { canAccessClass, canReadRecord, canReviewRecord } from "../src/domain/authorization.js";
import { validateExperiment } from "../src/domain/experiments/validation.js";
import { createExperimentRecord } from "../src/domain/experiments/record.js";
import { AIService, redactSupportedPii } from "../src/application/ai-service.js";
import { AppError } from "../src/application/errors.js";
import { errorEnvelope } from "../src/http/error-mapper.js";
import type { AIProvider, RateLimiter } from "../src/application/ports.js";
import type { AuditRepository, ExperimentRepository } from "../src/domain/repositories.js";
import type {
  AuditEvent,
  ExperimentRecord,
  ExperimentRecordInput,
  Session,
} from "../src/domain/types.js";
import { ExperimentService } from "../src/application/experiment-service.js";
import { homePage, loginPage } from "../src/views/pages.js";

const student: Session = {
  id: "s1",
  role: "student",
  username: "student-a",
  name: "A",
  class_name: "Class A",
};
const teacher: Session = {
  id: "t1",
  role: "teacher",
  username: "teacher-a",
  name: "T",
  class_name: "Class A",
};
const otherCommand: ExperimentRecordInput = {
  student_name: "Synthetic B",
  class_name: "Class B",
  group_name: "G1",
  nh4cl_concentration: 3,
  peel_mass: 100,
  oil_mass: 1,
  distillation_time: 45,
  phase_clarity_score: 4,
  emulsification_level: "轻微",
  emulsion_concentration: 20,
  ecoli_observation_group: "精油乳液组",
  inhibition_zone_diameter: 10,
  colony_growth_score: 3,
  异常标记: false,
  error_source: "",
  note: "",
};
const otherRecord = createExperimentRecord(otherCommand, {
  id: "record-b",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "teacher-b",
  reviewStatus: "normal",
});

test("domain validation returns structured scientific findings", () => {
  const invalid: ExperimentRecordInput = {
    ...otherRecord,
    student_name: "",
    nh4cl_concentration: 2,
    peel_mass: 0,
    inhibition_zone_diameter: 61,
  };
  const findings = validateExperiment(invalid);
  assert.deepEqual(
    findings.map((item) => item.field),
    ["student_name", "nh4cl_concentration", "peel_mass", "inhibition_zone_diameter"],
  );
  assert.ok(findings.every((item) => item.code === "INVALID_FIELD"));
});

test("authorization policy denies student and teacher cross-class access", () => {
  assert.equal(canAccessClass(student, "Class B"), false);
  assert.equal(canReadRecord(student, otherRecord), false);
  assert.equal(canReviewRecord(teacher, otherRecord), false);
  assert.equal(canAccessClass({ ...teacher, role: "admin" }, "Class B"), true);
});

test("fixed demo credentials render only when the isolated demo fixture is enabled", () => {
  assert.doesNotMatch(loginPage("student", null, false), /123456|student001/);
  assert.match(loginPage("student", null, true), /123456|student001/);
  assert.doesNotMatch(homePage(null, [], false), /student001 \/ 123456/);
});

test("experiment service uses repository boundary and enforces actor class", async () => {
  const stored: ExperimentRecord[] = [];
  const repository: ExperimentRepository = {
    findAll: async () => stored,
    findById: async (id) => stored.find((item) => item.id === id) ?? null,
    findByIdForAudit: async (id) => stored.find((item) => item.id === id) ?? null,
    findByClientSubmission: async () => null,
    add: async (record) => {
      stored.push({
        ...record,
        yield_percent: Number(((record.oil_mass / record.peel_mass) * 100).toFixed(2)),
        review_status: record.initial_quality_status || "normal",
        review_note: "",
        reviewed_at: "",
        reviewed_by: "",
        ai_diagnosis: record.ai_diagnosis || "",
      });
    },
    update: async () => null,
    delete: async () => false,
  };
  const events: AuditEvent[] = [];
  const audit: AuditRepository = {
    write: async (event) => {
      events.push(event);
    },
  };
  const service = new ExperimentService(repository, audit, {
    random: () => "generated-id",
    hashSession: (value) => value,
  });
  const result = await service.create(
    { ...otherCommand, class_name: "Class B" },
    { actor: student, ip: "127.0.0.1", ua: "test" },
  );
  assert.equal(result.record.class_name, "Class A");
  assert.equal(stored.length, 1);
  assert.equal(events.at(-1)?.action, "records.create");
});

test("AI service redacts supported PII and returns safe provider fallback", async () => {
  let observed = "";
  const provider: AIProvider = {
    status: () => ({
      configured: true,
      provider: "test",
      model: "test",
      base: "test",
      timeoutMs: 10,
    }),
    ask: async (question) => {
      observed = question.question;
      throw new Error("offline");
    },
  };
  const limiter: RateLimiter = { allow: () => true };
  const service = new AIService(provider, limiter, { write: async () => undefined });
  const result = await service.askSafely(
    { question: "邮箱 a@example.com 手机 13800138000", scene: "review", history: [] },
    "test",
  );
  assert.doesNotMatch(observed, /a@example\.com|13800138000/);
  assert.match(observed, /REDACTED_EMAIL/);
  assert.equal(result.mode, "local-fallback");
  assert.equal(result.reason, "deepseek_error");
  assert.doesNotMatch(redactSupportedPii("student001"), /student001/);
});

test("standardized error mapper hides internal errors and preserves stable codes", () => {
  const validation = errorEnvelope(
    new AppError("VALIDATION_ERROR", "bad input", 400, [{ field: "x", message: "bad" }]),
    "req-1",
  );
  assert.equal(validation.body.error.code, "VALIDATION_ERROR");
  assert.equal(validation.body.request_id, "req-1");
  const internal = errorEnvelope(new Error("SQL SELECT secret"), "req-2");
  assert.equal(internal.status, 500);
  assert.equal(internal.body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(internal.body.error.message, /SQL|secret/);
});
