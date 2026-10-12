import type { Migration } from "./types.js";

const machine = (column: string) =>
  `instr(${column},char(0))=0 AND length(${column}) BETWEEN 1 AND 256 AND ${column} NOT GLOB '*[^!-~]*'`;
const stamp = (column: string) =>
  `length(${column})=24 AND substr(${column},1,4) BETWEEN '0001' AND '9999'
    AND substr(${column},6,2) BETWEEN '01' AND '12' AND substr(${column},9,2) BETWEEN '01' AND '31'
    AND substr(${column},12,2) BETWEEN '00' AND '23' AND substr(${column},15,2) BETWEEN '00' AND '59'
    AND substr(${column},18,2) BETWEEN '00' AND '59'
    AND strftime('%Y-%m-%dT%H:%M:%fZ',${column},'+0 days') IS ${column}`;
const blank =
  "char(9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
// Frozen Unicode 17.0 General_Category=Cf ranges, matching the accepted filename
// contract. Never enumerate the runtime's Unicode categories when applying a migration.
const filenameFormatRanges = [
  [0xad, 0xad],
  [0x600, 0x605],
  [0x61c, 0x61c],
  [0x6dd, 0x6dd],
  [0x70f, 0x70f],
  [0x890, 0x891],
  [0x8e2, 0x8e2],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
] as const;
const noFilenameControls = [
  ...Array.from({ length: 32 }, (_, i) => i),
  ...Array.from({ length: 33 }, (_, i) => i + 127),
  ...filenameFormatRanges.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, i) => first + i),
  ),
]
  .map((code) => `instr(original_name,char(${code}))=0`)
  .join(" AND ");
const immutable = [
  "id",
  "object_key",
  "record_id",
  "csv_batch_id",
  "schema_version",
  "client_upload_id",
  "sha256",
  "byte_length",
  "media_type",
  "extension",
  "original_name",
  "uploader_user_id",
  "uploader_label_snapshot",
  "received_at",
  "app_version",
];

export const durableEvidenceStorageMigration: Migration = {
  version: 15,
  name: "durable_evidence_storage",
  up(database) {
    database.exec(`
      CREATE TABLE evidence_files (
        id TEXT PRIMARY KEY NOT NULL CHECK(${machine("id")}),
        object_key TEXT NOT NULL UNIQUE CHECK(length(object_key)=36 AND instr(object_key,char(0))=0
          AND substr(object_key,9,1)='-' AND substr(object_key,14,1)='-' AND substr(object_key,19,1)='-' AND substr(object_key,24,1)='-'
          AND length(replace(object_key,'-',''))=32 AND replace(object_key,'-','') NOT GLOB '*[^0-9a-f]*'
          AND substr(object_key,15,1)='4' AND substr(object_key,20,1) IN ('8','9','a','b')),
        record_id TEXT REFERENCES experiment_records(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        csv_batch_id TEXT REFERENCES csv_import_batches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        schema_version TEXT NOT NULL CHECK(schema_version='echoclass.evidence.v1'),
        client_upload_id TEXT NOT NULL CHECK(length(client_upload_id) BETWEEN 16 AND 128 AND instr(client_upload_id,char(0))=0 AND client_upload_id NOT GLOB '*[^A-Za-z0-9_-]*'),
        sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND instr(sha256,char(0))=0 AND sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 5242880),
        media_type TEXT NOT NULL,
        extension TEXT NOT NULL,
        original_name TEXT NOT NULL CHECK(length(original_name) BETWEEN 1 AND 255 AND length(trim(original_name,${blank}))>0
          AND instr(original_name,'/')=0 AND instr(original_name,char(92))=0 AND ${noFilenameControls}),
        uploader_user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        uploader_label_snapshot TEXT NOT NULL CHECK(length(trim(uploader_label_snapshot,${blank}))>0 AND instr(uploader_label_snapshot,char(0))=0),
        received_at TEXT NOT NULL CHECK(${stamp("received_at")}),
        app_version TEXT NOT NULL CHECK(length(app_version) BETWEEN 1 AND 64 AND instr(app_version,char(0))=0),
        archived_at TEXT CHECK(archived_at IS NULL OR (${stamp("archived_at")} AND archived_at>=received_at)),
        archived_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK((record_id IS NOT NULL AND csv_batch_id IS NULL) OR (record_id IS NULL AND csv_batch_id IS NOT NULL)),
        CHECK((archived_at IS NULL)=(archived_by_user_id IS NULL)),
        CHECK((record_id IS NOT NULL AND (
          (media_type='image/png' AND extension='png' AND lower(original_name) LIKE '%.png') OR
          (media_type='image/jpeg' AND extension='jpg' AND (lower(original_name) LIKE '%.jpg' OR lower(original_name) LIKE '%.jpeg')) OR
          (media_type='application/pdf' AND extension='pdf' AND lower(original_name) LIKE '%.pdf')))
          OR (csv_batch_id IS NOT NULL AND media_type='text/csv' AND extension='csv' AND lower(original_name) LIKE '%.csv' AND byte_length<=1048576))
      ) STRICT;
      CREATE UNIQUE INDEX uq_evidence_record_retry ON evidence_files(uploader_user_id,record_id,client_upload_id) WHERE record_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_evidence_csv_retry ON evidence_files(uploader_user_id,csv_batch_id,client_upload_id) WHERE csv_batch_id IS NOT NULL;
      CREATE INDEX idx_evidence_record ON evidence_files(record_id,received_at,id) WHERE record_id IS NOT NULL;
      CREATE INDEX idx_evidence_csv ON evidence_files(csv_batch_id,received_at,id) WHERE csv_batch_id IS NOT NULL;
      CREATE TRIGGER evidence_no_replacement BEFORE INSERT ON evidence_files
      WHEN EXISTS(SELECT 1 FROM evidence_files WHERE id=NEW.id OR object_key=NEW.object_key OR
        (uploader_user_id=NEW.uploader_user_id AND client_upload_id=NEW.client_upload_id AND
          ((record_id IS NOT NULL AND record_id=NEW.record_id) OR (csv_batch_id IS NOT NULL AND csv_batch_id=NEW.csv_batch_id))))
      BEGIN SELECT RAISE(ABORT,'Evidence replacement is forbidden'); END;
      CREATE TRIGGER evidence_insert_contract BEFORE INSERT ON evidence_files
      BEGIN
        SELECT CASE WHEN length(NEW.original_name)>255
          THEN RAISE(ABORT,'Evidence filename exceeds 255 UTF-16 units') END;
        SELECT CASE WHEN (WITH RECURSIVE positions(n) AS (
          SELECT 1 UNION ALL SELECT n+1 FROM positions WHERE n<length(NEW.original_name)
        ) SELECT sum(CASE WHEN unicode(substr(NEW.original_name,n,1))>65535 THEN 2 ELSE 1 END) FROM positions)>255
          THEN RAISE(ABORT,'Evidence filename exceeds 255 UTF-16 units') END;
        SELECT CASE WHEN NEW.archived_at IS NOT NULL OR NEW.archived_by_user_id IS NOT NULL
          THEN RAISE(ABORT,'Evidence cannot start archived') END;
        SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.uploader_user_id
          AND u.username=NEW.uploader_label_snapshot AND u.status='active' AND u.role IN ('student','teacher','admin'))
          THEN RAISE(ABORT,'Evidence uploader is invalid') END;
        SELECT CASE WHEN NEW.record_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM experiment_records er JOIN classes c ON c.id=er.class_id JOIN users u ON u.id=NEW.uploader_user_id
          WHERE er.id=NEW.record_id AND er.status='active' AND
            (u.role='admin' OR (u.class_name=c.name AND (u.role='teacher' OR (u.role='student' AND er.created_by_user_id=u.id)))))
          THEN RAISE(ABORT,'Evidence record target is invalid') END;
        SELECT CASE WHEN NEW.csv_batch_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM csv_import_batches b JOIN classes c ON c.id=b.class_id JOIN users u ON u.id=NEW.uploader_user_id
          WHERE b.id=NEW.csv_batch_id AND b.raw_sha256=NEW.sha256 AND b.byte_length=NEW.byte_length AND
            (u.role='admin' OR (u.role='teacher' AND b.uploader_user_id=u.id AND c.name=u.class_name AND NOT EXISTS(
              SELECT 1 FROM csv_import_rows cr JOIN experiment_records er ON er.id=cr.record_id JOIN classes cc ON cc.id=er.class_id
              WHERE cr.batch_id=b.id AND cc.name<>u.class_name))))
          THEN RAISE(ABORT,'Evidence CSV source is invalid') END;
        SELECT CASE WHEN (SELECT count(*) FROM evidence_files WHERE
          (NEW.record_id IS NOT NULL AND record_id=NEW.record_id) OR (NEW.csv_batch_id IS NOT NULL AND csv_batch_id=NEW.csv_batch_id))>=20
          THEN RAISE(ABORT,'Evidence target quota exceeded') END;
        SELECT CASE WHEN (SELECT COALESCE(sum(byte_length),0) FROM evidence_files)+NEW.byte_length>1073741824
          THEN RAISE(ABORT,'Evidence byte quota exceeded') END;
      END;
      CREATE TRIGGER evidence_archive_only BEFORE UPDATE ON evidence_files
      BEGIN
        SELECT CASE WHEN ${immutable.map((column) => `NEW.${column} IS NOT OLD.${column}`).join(" OR ")}
          THEN RAISE(ABORT,'Evidence metadata is immutable') END;
        SELECT CASE WHEN OLD.archived_at IS NOT NULL OR OLD.archived_by_user_id IS NOT NULL OR NEW.archived_at IS NULL OR NEW.archived_by_user_id IS NULL
          THEN RAISE(ABORT,'Evidence archive transition is invalid') END;
        SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.archived_by_user_id AND u.status='active' AND
          (u.role='admin' OR (u.role='teacher' AND (
            (OLD.record_id IS NOT NULL AND EXISTS(SELECT 1 FROM experiment_records er JOIN classes c ON c.id=er.class_id WHERE er.id=OLD.record_id AND c.name=u.class_name)) OR
            (OLD.csv_batch_id IS NOT NULL AND EXISTS(SELECT 1 FROM csv_import_batches b JOIN classes c ON c.id=b.class_id
              WHERE b.id=OLD.csv_batch_id AND b.uploader_user_id=u.id AND c.name=u.class_name AND NOT EXISTS(
                SELECT 1 FROM csv_import_rows cr JOIN experiment_records er ON er.id=cr.record_id JOIN classes cc ON cc.id=er.class_id WHERE cr.batch_id=b.id AND cc.name<>u.class_name)))))))
          THEN RAISE(ABORT,'Evidence archive authority is invalid') END;
      END;
      CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence_files BEGIN SELECT RAISE(ABORT,'Evidence deletion is forbidden'); END;
    `);
  },
};
