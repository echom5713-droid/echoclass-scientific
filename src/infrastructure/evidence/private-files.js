import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const OBJECT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
export const MAX_OBJECT_BYTES = 5_242_880;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateObject(object) {
  if (
    !object ||
    typeof object.object_key !== "string" ||
    !OBJECT_KEY.test(object.object_key) ||
    typeof object.sha256 !== "string" ||
    !DIGEST.test(object.sha256) ||
    !Number.isSafeInteger(object.byte_length) ||
    object.byte_length < 1 ||
    object.byte_length > MAX_OBJECT_BYTES
  )
    throw new Error("Invalid evidence reference");
}

// The host and parent directories must remain under the operator's control.
// These checks reject existing links; they do not promise protection against a
// privileged process swapping ancestor directories between system calls.
export async function privateDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (!create || error?.code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
        await syncDirectory(path.dirname(current));
      } catch (creationError) {
        if (creationError?.code !== "EEXIST") throw creationError;
      }
      stat = await lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe directory");
  }
  return absolute;
}

export async function syncDirectory(directory) {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readVerifiedObject(directory, object) {
  // Retain the requested identity across asynchronous filesystem work.
  const reference = {
    object_key: object?.object_key,
    sha256: object?.sha256,
    byte_length: object?.byte_length,
  };
  validateObject(reference);
  await privateDirectory(directory);
  const handle = await open(
    path.join(directory, reference.object_key),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== reference.byte_length)
      throw new Error("Unavailable evidence object");
    const bytes = Buffer.alloc(reference.byte_length);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("Incomplete evidence object");
      offset += bytesRead;
    }
    if (
      (await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead ||
      sha256(bytes) !== reference.sha256
    )
      throw new Error("Altered evidence object");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function writeExclusive(file, bytes, mode = 0o600) {
  const handle = await open(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
