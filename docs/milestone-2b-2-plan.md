# Durable evidence and recovery — implementation contract

Date: 2026-09-05. This follows the CSV corrective gate at beta.13. Design reviewed independently before implementation. Target: beta.14 / additive Migration 015. Released migrations 001–014 stay frozen.

## Purpose and limits

Save a small file alongside an experiment or retain the exact source of an existing CSV import, then retrieve it under current permissions and restore it from a verified backup. This establishes byte custody from the actual upload time. It does not prove the experiment happened, establish asset rights, or retroactively identify a photo used for an earlier browser calibration.

Keep Node, SQLite and a private local filesystem. No object-store account, queue, deduplication, generic document manager, OCR or image model. Bytes never go in experiment JSON, database BLOBs or the public static directory. JSON compatibility mode returns 503.

## Fixed data and access contract

One STRICT `evidence_files` table holds immutable metadata and exactly one foreign-key target: `record_id` or `csv_batch_id`. Fields include ID, UUID object key, target, SHA-256, byte length, canonical media type/extension, original filename, uploader ID/label snapshot, actual `received_at`, app version, client upload token and optional one-way archive actor/time. Two partial unique indexes scope retries by uploader + target + token. Digest alone is not unique. SHA/length/type/target/schema define a retry fingerprint; first-upload filename and time do not change on replay.

Only an active authenticated account can act. Students may upload/read evidence for their own currently active record in their current class. Teachers may upload/read evidence for records in their current class; administrators may cross classes. New uploads cannot target an archived record. Teachers/admins can inspect archived record evidence and archive evidence within current scope; students cannot archive or read archived evidence. Archive retains metadata and bytes. Replaying an archived upload returns its original archived receipt only to an actor currently allowed to read that archived evidence; a student retry is denied with zero additions. Nothing restores it.

CSV source access follows the existing receipt rule: original uploader and original class still authorized, and every mapped record's current class authorized; administrators have cross-class access. Students cannot access batch sources. An upload's actual digest and byte length must equal the durable receipt, with an additional database relationship guard.

PNG (`image/png`, `.png`), JPEG (`image/jpeg`, `.jpg` or `.jpeg`, canonical `.jpg`) and PDF (`application/pdf`, `.pdf`) are record attachments up to 5 MiB. Their extension, declared MIME and signature must agree. Signature screening is not a full parser, antivirus scan or format-safety certification. PDF is an opaque download, never embedded or executed. CSV (`text/csv`, `.csv`) is limited to source batches, 1 MiB, strict UTF-8 and exact receipt digest/length; CSV has no reliable universal magic signature. All formats reject zero bytes. Filenames are bounded nonblank display text without controls or path separators; they never choose a storage path or download header.

The first version retains at most 20 files per target, counting archived files, and 1 GiB of referenced evidence per database. Enforce both within the metadata transaction. Limit expensive operations to 10 per user per minute and permit at most four concurrent file operations per process. These are explicit local deployment limits, not a distributed quota claim. Orphans can consume extra space after failures; no automatic eviction or cleanup is included.

## File and transaction protocol

Private storage is `<dataDir>/evidence/objects/<UUID>`, with same-filesystem staging under `<dataDir>/evidence/staging`. Server-generated UUIDs are never overwritten. Exclusive file creation, fsync, hard-link publication and directory sync precede the metadata transaction. Each final object has one upload identity; no shared reference counting is necessary.

Upload: authorize and bound input → validate and hash bytes → look up an existing authorized retry → publish immutable bytes → synchronous BEGIN IMMEDIATE → re-read current session/account/target and retry winner → enforce limits → insert metadata and one success audit → COMMIT → receipt. No await or filesystem call occurs in the SQLite transaction. Two simultaneous identical attempts can publish separate objects, but exactly one metadata row wins. A file published before a failed/uncertain commit may be an orphan. Never guess that it is safe to delete after an ambiguous result.

Read: authorize and read metadata → open controlled key without following a symlink → require a regular file, bounded size and matching digest → reauthorize after the asynchronous read → send verified bytes. Missing/corrupt objects return 503 before any download bytes. Fixed ASCII download names, attachment disposition, no-store and nosniff apply. No inline preview, Range support or public file URL.

Migration 015 rejects mutable metadata, DELETE/REPLACE, malformed field/type/target combinations, mismatched CSV source links and incomplete archive transitions. Metadata guards prove database relationships, not the existence or historical custody of external bytes. Keep current-session and CSV receipt checks shared within infrastructure without nesting transactions or adding a transaction framework.

## HTTP and small interface

Use raw request bodies, a single canonical Content-Type, `X-EchoClass-Client-Upload-Id` and a single bounded filename query parameter. Reject unknown/repeated parameters, content encodings, wrong methods, oversized content lengths, chunked overflow and 15-second upload timeout. Keep the existing origin and safe error envelope rules.

- `GET/POST /api/records/{id}/evidence`
- `GET/POST /api/csv/imports/{id}/evidence`
- `GET /api/evidence/{id}`
- `GET /api/evidence/{id}/download`
- `POST /api/evidence/{id}/archive`

A small `/evidence` page links from record and CSV receipt views, shows actual filename/type/size/hash/received time and offers upload, download and authorized archive actions. Cache retry identity per user/target/digest in session storage; selecting another file cannot lose an uncertain attempt. Replacing a token requires explicit confirmation. Use textContent for metadata. Explain the actual-time custody boundary in ordinary product language.

## Backup and restore

Replace the old direct-copy restore and unsafe backup fallback. `npm run backup -- <new-backup-directory>` uses ECHOCLASS_DATA_DIR (default `data`), requires SQLite and produces: VACUUM INTO consistent database snapshot → enumerate all evidence references from that snapshot including archived rows → copy and hash-check each immutable object → database integrity/FK/schema checks → fsync the database, every copied object and their directories → fsync manifest and completion last. Never fall back to copying a live main DB when VACUUM fails. No physical object deletion makes this snapshot protocol safe against ordinary concurrent new uploads.

`npm run restore -- <backup-directory> <new-data-directory>` refuses an existing target, traversals, symlinks, malformed/incomplete manifests, altered database/files and mismatched reference sets. Verify and sync all restored data before publishing a completed restored directory without overwriting another target; sync its parent directory as well. It must never overwrite a live directory. The restored data root can then be selected with ECHOCLASS_DATA_DIR after the original process is stopped. Shell wrappers delegate to the same implementation. These commands cover SQLite and evidence only; separately stored practice answers and deployment settings are outside this backup contract and must not be described as restored application state.

## Required evidence

Test actual HTTP upload/restart/download, formats and byte limits, current role/class/ownership, revocation across async boundaries, moved CSV records, archive access, retry races/lost response, SQL immutability and rollback, failed publication/audit and retained orphan behavior, non-overwrite/symlink/missing/corrupt files, snapshot membership, archived-file inclusion and a verified restored database with readable objects. Reject broken backups and existing restore destinations. Then run the existing full project gates, freeze-check old migrations, exact-SHA CI and an independent clean-archive audit.

The existing owner risk register stays OPEN: old provider key, asset rights, historical deployment accounts/data and external schema-v7 copies. No deployment or public release. Next is scientific Python analysis of sealed inputs, followed by grounded explanations with measured retrieval/citation behavior.
