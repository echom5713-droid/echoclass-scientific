import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import path from "node:path";
import {
  EvidenceFault,
  EVIDENCE_LIMITS,
  type EvidenceFileStore,
  type EvidenceObject,
} from "../../domain/evidence/contract.js";
import { privateDirectory, readVerifiedObject, sha256, syncDirectory } from "./private-files.js";

function unavailable(): EvidenceFault {
  return new EvidenceFault(
    "unavailable",
    "EVIDENCE_STORAGE_UNAVAILABLE",
    "证据文件暂时不可用，请稍后重试。",
  );
}

export class LocalEvidenceFileStore implements EvidenceFileStore {
  private readonly dataDir: string;
  private readonly objects: string;
  private readonly staging: string;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.objects = path.join(this.dataDir, "evidence", "objects");
    this.staging = path.join(this.dataDir, "evidence", "staging");
  }

  async put(input: Uint8Array): Promise<EvidenceObject> {
    if (
      !(input instanceof Uint8Array) ||
      input.byteLength < 1 ||
      input.byteLength > EVIDENCE_LIMITS.bytes
    )
      throw new EvidenceFault("input", "INVALID_EVIDENCE_LENGTH", "证据文件大小不符合要求。");
    // Take ownership before the first asynchronous boundary.
    const bytes = Buffer.from(input);
    const object: EvidenceObject = {
      object_key: randomUUID(),
      sha256: sha256(bytes),
      byte_length: bytes.byteLength,
    };
    const temporary = path.join(this.staging, randomUUID());
    let staged = false;
    try {
      await privateDirectory(this.objects, true);
      await privateDirectory(this.staging, true);
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      staged = true;
      try {
        await handle.writeFile(bytes);
        await handle.chmod(0o400);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // link() is an atomic publish that fails if the destination already exists.
      // An error after this point can leave an orphan. Never delete final objects:
      // an application transaction may have committed despite a lost response.
      await link(temporary, path.join(this.objects, object.object_key));
      await syncDirectory(this.objects);
      await syncDirectory(path.dirname(this.objects));
      await syncDirectory(this.dataDir);
      await syncDirectory(path.dirname(this.dataDir));
      await unlink(temporary);
      staged = false;
      await syncDirectory(this.staging);
      return object;
    } catch {
      throw unavailable();
    } finally {
      if (staged) {
        try {
          await unlink(temporary);
        } catch {
          /* Failed staging files are not published references. */
        }
      }
    }
  }

  async read(object: EvidenceObject): Promise<Uint8Array> {
    try {
      return await readVerifiedObject(this.objects, object);
    } catch {
      throw unavailable();
    }
  }
}
