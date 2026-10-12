import type { DatabaseSync } from "node:sqlite";
import type { RecordReview } from "../src/domain/types.js";
import { SqliteProvenanceStore } from "../src/infrastructure/database/sqlite-provenance-store.js";

/** Persists an authorized current human review while retaining deterministic test identity/time. */
export function appendHumanReview(database: DatabaseSync, review: RecordReview): RecordReview {
  if (review.provenance_kind !== "human" || !review.reviewer_user_id)
    throw new Error("appendHumanReview requires an authoritative human review");
  const randomId = review.id.startsWith("review-") ? review.id.slice("review-".length) : review.id;
  const store = new SqliteProvenanceStore(
    database,
    { now: () => review.created_at },
    { random: () => randomId, hashSession: (value) => value },
  );
  const projected = store.appendReview({
    record_id: review.record_id,
    reviewer_user_id: review.reviewer_user_id,
    status: review.status,
    note: review.note,
    reviewed_by: review.reviewed_by,
  });
  if (!projected) throw new Error(`review target ${review.record_id} does not exist`);
  const persisted = store.getEffectiveReview(review.record_id);
  if (!persisted || persisted.id !== review.id)
    throw new Error(`review ${review.id} was not persisted as the effective event`);
  return persisted;
}
