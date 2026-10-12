import path from "node:path";
import { createBackup } from "./evidence-backup.mjs";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: npm run backup -- <new-backup-directory>");
  process.exitCode = 1;
} else {
  try {
    const manifest = await createBackup(
      process.env.ECHOCLASS_DATA_DIR || path.join(process.cwd(), "data"),
      args[0],
    );
    console.log(
      `Backup complete: ${manifest.objects.length} evidence files; SQLite and evidence only. Practice answers and deployment settings need separate backups.`,
    );
  } catch (error) {
    console.error(
      `Backup failed: ${error.message}. No live-database copy fallback was used. A directory without COMPLETE is not a backup.`,
    );
    process.exitCode = 1;
  }
}
