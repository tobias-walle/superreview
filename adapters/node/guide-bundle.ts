import { open, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, sep } from "node:path";
import type { GuideBundle } from "../../lib/review/guide";
import {
  GUIDE_LIMITS,
  guideManifestSchema,
  safeGuideContentPath,
} from "../../lib/review/guide-validation";

function contained(root: string, path: string) {
  if (path === root || !path.startsWith(root + sep))
    throw new Error("Guide content path escapes the bundle root");
}
async function boundedRead(root: string, relative: string, limit: number): Promise<string> {
  if (!safeGuideContentPath(relative)) throw new Error("Invalid guide content path");
  const path = await realpath(resolve(root, relative));
  contained(root, path);
  if (!(await stat(path)).isFile())
    throw new Error(`Guide content must be a regular file: ${relative}`);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error(`Guide content must be a regular file: ${relative}`);
    if (info.size > limit) throw new Error(`Guide file exceeds byte limit: ${relative}`);
    // Read at most limit + 1, including when a file grows after stat().
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error(`Guide file exceeds byte limit: ${relative}`);
    const currentPath = await realpath(resolve(root, relative));
    contained(root, currentPath);
    const current = await stat(currentPath);
    if (current.dev !== info.dev || current.ino !== info.ino)
      throw new Error(`Guide file changed while reading: ${relative}`);
    const bytes = buffer.subarray(0, size);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes) || bytes.includes(0))
      throw new Error(`Guide content must be UTF-8 text: ${relative}`);
    return text;
  } finally {
    await file.close();
  }
}

/** External authoring files are read once into a bounded, self-contained bundle. */
export async function readGuideBundle(directory: string): Promise<GuideBundle> {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error("Bundle root must be a directory");
  const manifestText = await boundedRead(root, "guide.json", GUIDE_LIMITS.manifestBytes);
  const manifest = guideManifestSchema.parse(JSON.parse(manifestText));
  let total = Buffer.byteLength(manifestText);
  const documents: Record<string, string> = Object.create(null);
  for (const chunk of manifest.chunks) {
    if (Object.hasOwn(documents, chunk.content)) continue;
    const document = await boundedRead(root, chunk.content, GUIDE_LIMITS.documentBytes);
    total += Buffer.byteLength(document);
    if (total > GUIDE_LIMITS.bundleBytes) throw new Error("Guide bundle exceeds total byte limit");
    documents[chunk.content] = document;
  }
  return { manifest, documents: { ...documents } };
}
