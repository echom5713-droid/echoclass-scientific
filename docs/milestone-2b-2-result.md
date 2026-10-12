# Durable evidence implementation result

Date: 2026-09-05. Version: `3.0.0-beta.14`, SQLite schema 15. Parent: `f745cd6e3bf857ae9b60d3b56018bf2a008c56c0`. The implementation follows the independently reviewed [evidence contract](milestone-2b-2-plan.md).

## Implemented behavior

Record attachments accept PNG, JPEG and opaque PDF downloads up to 5 MiB. Original CSV files up to 1 MiB can be attached to their existing import batch only when the raw digest and byte length match its receipt. Type, extension, signature where applicable, strict UTF-8 for CSV, filename and body limits are checked. CSV has no generic magic signature. A later upload records its actual reception time rather than backdating custody.

A private filesystem adapter exclusively creates and syncs a staging file, publishes a UUID object by non-overwriting hard link, and syncs directories before metadata commit. The synchronous SQLite transaction rechecks the current account, target, retry winner and quotas, then inserts metadata plus the success audit. Known mismatched CSV sources or exhausted quotas fail before file publication. A concurrent or uncertain database failure can still leave an unreferenced object; no final-object deletion or online garbage collection is attempted.

Migration 015 uses one STRICT table with two mutually exclusive foreign-key targets. It rejects metadata changes, deletion/replacement, invalid CSV source links, incomplete archive transitions and quota violations. Retention limits are 20 files per target including archived files, and 1 GiB of referenced evidence per database. These are database-enforced local limits; orphan bytes are outside that accounting.

Students access only their own active records in their current class and cannot retrieve archived evidence. Teachers/admins retain current-scope audit access. CSV source access shares the existing receipt's original-uploader/original-class/current-record-class checks. Every download verifies regular-file identity, bounded length and digest, then rechecks current permission before sending any bytes. File-store paths and object keys do not appear in public metadata. Downloads use a fixed ASCII filename, attachment disposition, no-store and nosniff.

The small attachment page links from records and CSV receipts. It retains upload identities per user/target/file digest across file changes and reload, requires confirmation to start another upload, and inserts metadata as text. Raw request bodies reserve one of four process-wide file-operation slots before reading; ten expensive operations per user per minute are allowed. No image preview, PDF embedding, multipart parser, object-store account, OCR or model inference is added.

## Recovery

Backup uses VACUUM INTO to capture committed SQLite state, enumerates all referenced objects from that snapshot, copies and verifies their bytes, syncs database/objects/directories, and writes a digest-bound manifest and completion marker last. It never falls back to copying a live main DB file. Source uploads committed after the snapshot do not enter that backup.

Restore verifies the complete package and exact database reference set before reserving a new directory. It writes `RESTORE_IN_PROGRESS` before copying a database, verifies and syncs the restored data, writes completion evidence, then removes the marker last. Startup rejects a directory with that marker before initializing SQLite or JSON data. Existing directories are never overwritten. Failed restores remain marked for inspection; retry uses another destination.

The tools accept the complete schema-15 ledger and reject unrecognized/older schemas rather than treating a missing evidence table as empty. A future schema must explicitly update backup support. Scope is SQLite plus evidence, not practice answers, deployment settings, keys or the whole host. A 64 MiB manifest parsing limit bounds maintenance-tool memory.

## Verification record

All fixtures are synthetic and use temporary databases/directories. Targeted author checks include 16 repository cases plus the 27 existing CSV cases; 10 private-file cases; 40 backup/recovery cases; 11 service/body cases; seven live HTTP cases; client retry tests; and two incomplete-startup cases. The final full-project gate passed: 486/486 tests, 28/28 HTTP integration tests, installation, lint, typecheck, build, smoke, security, formatting, the separate 4/4 architecture gate and diff check. The exact-SHA CI conclusion and final archive digest are recorded in the post-commit delivery manifest.

Tests exercise real WAL writers racing the same token and final quota slot, connection reopen after a lost response, actual deferred-FK COMMIT failure, audit rollback, fresh-session and class changes, archive permissions, SQL replacement/immutability guards, schema-14 upgrade/rerun/migration rollback and frozen migration fingerprints. Filesystem checks include forced UUID collision, symlinks/non-regular files, input/reference mutation, failed directory sync after real hard-link publication, missing/corrupt files, and verification before response headers.

Backup tests demonstrate that a main-file-only copy can miss committed WAL state. They verify snapshot membership during a new upload, archived-object inclusion, recovery into a fresh directory, and failure on altered manifests/objects/reference sets. A synthetic write implementation reports success while storing same-length wrong bytes; read-back validation rejects the backup and restore. Fault injection is clearly synthetic; no physical power-loss or production-storage certification is claimed.

Independent review reproduced two boundary mismatches before release: browser CSV MIME hints could unnecessarily block a valid source re-upload, and raw SQL could accept filenames or hour-24 timestamps that strict repository reads then rejected. The page now derives its CSV declaration from the .csv suffix and leaves byte verification to the server. Migration 015 aligns frozen format-control ranges, UTF-16 filename length and strict calendar/time rules with runtime validation. Raw-SQL regression tests verify rejection while valid supplementary-plane filenames and leap-day timestamps remain readable. No previously released migration was edited.

The first full regression run passed 485 of 486 tests; the sole failure was a stale beta.13 literal in the existing runtime-version assertion. The assertion was advanced to beta.14 without weakening its identity check.

The independent agent audit closed the reproduced findings and reported no remaining blocker in the reviewed permission, transaction, retry and recovery scope. It independently ran 50 file/backup tests, 24 service/client tests, and a separate source-compiled 16-case repository suite plus the existing 27 CSV cases. This is an independent agent review, not a claim of a human or named-model audit. Final Git/archive identity is checked separately after commit.

## Boundaries

The host directories must remain controlled by the operator. Existing symlinks are rejected, but no protection against a privileged process racing ancestor-directory replacements is claimed. The verified environment is Linux with local hard links, NOFOLLOW and directory fsync. No graphical browser was run; actual client-script execution and real HTTP are separate recorded checks.

Hashes identify bytes and help detect damage; they do not establish scientific truth, asset rights or recover missing bytes. Attaching a photo does not retroactively attest a manual calibration. The four owner actions remain OPEN: old provider-key revoke/rotate, bundled-asset rights/consent, historical deployment accounts/data, and external schema-v7 database/backup inventory with a separately reviewed upgrade path. No deployment or public release is included.
