import { restoreBackup } from "./evidence-backup.mjs";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: npm run restore -- <backup-directory> <new-data-directory>");
  process.exitCode = 1;
} else {
  try {
    const manifest = await restoreBackup(args[0], args[1]);
    console.log(
      `Restore complete: ${manifest.objects.length} evidence files. Stop the original process before selecting the new ECHOCLASS_DATA_DIR. Practice answers and deployment settings were not restored.`,
    );
  } catch (error) {
    console.error(
      `Restore failed: ${error.message}. Existing directories were not overwritten. Do not start a directory marked RESTORE_IN_PROGRESS; retry with a new destination.`,
    );
    process.exitCode = 1;
  }
}
