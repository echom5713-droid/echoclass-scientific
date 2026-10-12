import type { Migration } from "./types.js";

export const csvInterchangeMigration: Migration = {
  version: 13,
  name: "csv_interchange",
  up(database) {
    database.exec(`
      CREATE TABLE csv_import_batches (
        id TEXT PRIMARY KEY NOT NULL CHECK(instr(id,char(0))=0 AND length(id) BETWEEN 1 AND 256 AND id NOT GLOB '*[^!-~]*'),
        uploader_user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        class_id TEXT NOT NULL REFERENCES classes(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        client_import_id TEXT NOT NULL CHECK(instr(client_import_id,char(0))=0 AND length(client_import_id) BETWEEN 16 AND 128 AND client_import_id NOT GLOB '*[^A-Za-z0-9_-]*'),
        schema_version TEXT NOT NULL CHECK(schema_version='echoclass.csv.experiment.v1'),
        raw_sha256 TEXT NOT NULL CHECK(instr(raw_sha256,char(0))=0 AND length(raw_sha256)=64 AND raw_sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 1048576),
        row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 500),
        created_at TEXT NOT NULL CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
        completed_at TEXT NOT NULL CHECK(length(completed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',completed_at) IS completed_at AND completed_at>=created_at),
        uploader_label_snapshot TEXT NOT NULL CHECK(length(uploader_label_snapshot)>0),
        class_name_snapshot TEXT NOT NULL CHECK(length(class_name_snapshot)>0),
        app_version TEXT NOT NULL CHECK(length(app_version) BETWEEN 1 AND 64),
        diagnostics_policy TEXT NOT NULL CHECK(diagnostics_policy='pre_import_class_cohort.v1'),
        UNIQUE(uploader_user_id,class_id,client_import_id)
      ) STRICT;
      CREATE TABLE csv_import_rows (
        batch_id TEXT NOT NULL CHECK(instr(batch_id,char(0))=0 AND length(batch_id) BETWEEN 1 AND 256 AND batch_id NOT GLOB '*[^!-~]*'),
        row_number INTEGER NOT NULL CHECK(row_number BETWEEN 1 AND 500),
        record_id TEXT NOT NULL UNIQUE CHECK(instr(record_id,char(0))=0 AND length(record_id) BETWEEN 1 AND 256 AND record_id NOT GLOB '*[^!-~]*') REFERENCES experiment_records(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        PRIMARY KEY(batch_id,row_number),
        FOREIGN KEY(batch_id) REFERENCES csv_import_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TRIGGER csv_batches_duplicate BEFORE INSERT ON csv_import_batches
      WHEN EXISTS(SELECT 1 FROM csv_import_batches WHERE id=NEW.id OR
        (uploader_user_id=NEW.uploader_user_id AND class_id=NEW.class_id AND client_import_id=NEW.client_import_id))
      BEGIN SELECT RAISE(ABORT,'CSV batch replacement is forbidden'); END;
      CREATE TRIGGER csv_rows_duplicate BEFORE INSERT ON csv_import_rows
      WHEN EXISTS(SELECT 1 FROM csv_import_rows WHERE record_id=NEW.record_id OR (batch_id=NEW.batch_id AND row_number=NEW.row_number))
      BEGIN SELECT RAISE(ABORT,'CSV row replacement is forbidden'); END;
      CREATE TRIGGER csv_rows_closed BEFORE INSERT ON csv_import_rows
      WHEN EXISTS(SELECT 1 FROM csv_import_batches WHERE id=NEW.batch_id)
      BEGIN SELECT RAISE(ABORT,'CSV batch is complete'); END;
      CREATE TRIGGER csv_batch_complete BEFORE INSERT ON csv_import_batches
      BEGIN
        SELECT CASE WHEN
          (SELECT count(*) FROM csv_import_rows WHERE batch_id=NEW.id)<>NEW.row_count OR
          (SELECT min(row_number) FROM csv_import_rows WHERE batch_id=NEW.id) IS NOT 1 OR
          (SELECT max(row_number) FROM csv_import_rows WHERE batch_id=NEW.id) IS NOT NEW.row_count
          THEN RAISE(ABORT,'CSV batch mapping is incomplete') END;
        SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_user_id
          AND username=NEW.uploader_label_snapshot AND status='active' AND role IN ('teacher','admin'))
          OR NOT EXISTS(SELECT 1 FROM classes WHERE id=NEW.class_id AND name=NEW.class_name_snapshot)
          THEN RAISE(ABORT,'CSV batch attribution is invalid') END;
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM csv_import_rows cr LEFT JOIN experiment_records er ON er.id=cr.record_id
          WHERE cr.batch_id=NEW.id AND (er.id IS NULL OR er.class_id IS NOT NEW.class_id OR
            er.created_by_user_id IS NOT NEW.uploader_user_id OR er.created_by_label IS NOT NEW.uploader_label_snapshot OR
            er.submission_kind IS NOT 'canonical_submission' OR er.status IS NOT 'active' OR
            er.synced_from_offline IS NOT 0 OR er.client_submission_id IS NOT NULL OR
            er.idempotency_scope_class_id IS NOT NULL OR er.storage_import_id IS NOT NULL OR
            json_extract(er.submitted_json,'$.class_name') IS NOT NEW.class_name_snapshot))
          THEN RAISE(ABORT,'CSV row attribution is invalid') END;
      END;
      CREATE TRIGGER csv_batches_no_update BEFORE UPDATE ON csv_import_batches BEGIN SELECT RAISE(ABORT,'CSV batches are immutable'); END;
      CREATE TRIGGER csv_batches_no_delete BEFORE DELETE ON csv_import_batches BEGIN SELECT RAISE(ABORT,'CSV batches are immutable'); END;
      CREATE TRIGGER csv_rows_no_update BEFORE UPDATE ON csv_import_rows BEGIN SELECT RAISE(ABORT,'CSV rows are immutable'); END;
      CREATE TRIGGER csv_rows_no_delete BEFORE DELETE ON csv_import_rows BEGIN SELECT RAISE(ABORT,'CSV rows are immutable'); END;
    `);
  },
};
