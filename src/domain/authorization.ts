import type { ExperimentRecord, Session, UserRole } from "./types.js";

export function requiresPasswordChange(actor: Session | null): boolean {
  return actor !== null && actor.defaultPassword === true && actor.status !== "demo";
}

export function hasRole(actor: Session | null, allowedRoles: readonly UserRole[]): boolean {
  return actor !== null && !requiresPasswordChange(actor) && allowedRoles.includes(actor.role);
}

export function canAccessClass(actor: Session | null, className: string): boolean {
  if (!actor || requiresPasswordChange(actor)) return false;
  if (actor.role === "admin") return true;
  return Boolean(actor.class_name) && actor.class_name === className;
}

export function canReadRecord(actor: Session | null, record: ExperimentRecord): boolean {
  return canAccessClass(actor, record.class_name);
}

export function canCreateRecord(actor: Session | null, className: string): boolean {
  return hasRole(actor, ["student", "teacher", "admin"]) && canAccessClass(actor, className);
}

export function canReviewRecord(actor: Session | null, record: ExperimentRecord): boolean {
  return hasRole(actor, ["teacher", "admin"]) && canAccessClass(actor, record.class_name);
}
