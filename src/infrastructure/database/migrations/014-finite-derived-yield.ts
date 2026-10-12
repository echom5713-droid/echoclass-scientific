import type { Migration } from "./types.js";

// IEEE-754's finite bound is a storage limit, not a scientific mass/yield limit.
// Keep the established division-then-multiplication order and rounding contract.
const maxFinite = "1.7976931348623157e308";
const invalidYield = (prefix: string) => {
  const stored = `${prefix}yield_percent`;
  const derived = `((${prefix}oil_mass/${prefix}peel_mass)*100.0)`;
  return `COALESCE(${stored} BETWEEN -${maxFinite} AND ${maxFinite},0)=0
    OR COALESCE(${derived} BETWEEN -${maxFinite} AND ${maxFinite},0)=0`;
};

export const finiteDerivedYieldMigration: Migration = {
  version: 14,
  name: "finite_derived_yield",
  preflight(database) {
    const invalid = database
      .prepare(`SELECT id FROM experiment_records WHERE ${invalidYield("")} ORDER BY id`)
      .all();
    if (invalid.length)
      throw new Error(
        `Migration 014 non-finite experiment yield in records: ${JSON.stringify(invalid.map((row) => row.id))}`,
      );
  },
  up(database) {
    database.exec(`
      CREATE TRIGGER experiment_finite_yield_insert_guard
      BEFORE INSERT ON experiment_records
      WHEN ${invalidYield("NEW.")}
      BEGIN SELECT RAISE(ABORT,'non-finite experiment yield'); END;
      CREATE TRIGGER experiment_finite_yield_update_guard
      BEFORE UPDATE OF peel_mass,oil_mass,yield_percent ON experiment_records
      WHEN ${invalidYield("NEW.")}
      BEGIN SELECT RAISE(ABORT,'non-finite experiment yield'); END;
    `);
  },
};
