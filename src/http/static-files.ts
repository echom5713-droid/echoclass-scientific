import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { operationLanguageScript } from "../shared/operation-copy.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".mp4": "video/mp4",
};

export async function serveStatic(
  urlPath: string,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<boolean> {
  if (urlPath === "/static/operation-language.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(operationLanguageScript());
    return true;
  }
  const root = path.resolve(process.cwd(), "public");
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.replace(/^\/static\//, ""));
  } catch {
    return false;
  }
  const file = path.resolve(root, relative);
  const fromRoot = path.relative(root, file);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || !existsSync(file))
    return false;
  const extension = path.extname(file).toLowerCase();
  const type = CONTENT_TYPES[extension] ?? "application/octet-stream";
  const cache = extension === ".js" ? "no-cache" : "public, max-age=3600";
  if (extension !== ".mp4") {
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
    res.end(await readFile(file));
    return true;
  }
  const size = statSync(file).size;
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": size,
      "Accept-Ranges": "bytes",
      "Cache-Control": cache,
    });
    createReadStream(file).pipe(res);
    return true;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return true;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return true;
  }
  end = Math.min(end, size - 1);
  res.writeHead(206, {
    "Content-Type": type,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
  });
  createReadStream(file, { start, end }).pipe(res);
  return true;
}
