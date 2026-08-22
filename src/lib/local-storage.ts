import { randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

// Replaces Vercel Blob for the offline build — files live on disk instead of
// in cloud storage. Electron's main process sets LOCAL_UPLOADS_DIR to the
// OS's per-app data directory before spawning the Next server; falling back
// to ./uploads keeps `npm run dev` working without Electron in the loop.
function uploadsDir(): string {
  return process.env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

export const ALLOWED_UPLOAD_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export async function saveLocalFile(
  buffer: Buffer,
  mimeType: string
): Promise<{ url: string; filename: string }> {
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });

  const ext = EXT_BY_MIME[mimeType] ?? "";
  const filename = `${randomBytes(16).toString("hex")}${ext}`;
  await writeFile(path.join(dir, filename), buffer);

  return { url: `/api/files/${filename}`, filename };
}

export async function readLocalFile(
  filename: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // Reject anything that isn't a bare filename — this serves whatever it's
  // asked for by name, so path traversal (`../../etc/passwd`) has to be
  // ruled out before touching the filesystem.
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return null;
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeType = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0];
  if (!mimeType) return null;

  try {
    const buffer = await readFile(path.join(uploadsDir(), filename));
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

/** Best-effort delete, given a stored fileUrl like "/api/files/<name>.pdf". */
export async function deleteLocalFileByUrl(url: string): Promise<void> {
  const filename = url.split("/").pop();
  if (!filename || filename.includes("..")) return;
  try {
    await unlink(path.join(uploadsDir(), filename));
  } catch {
    // already gone, or never existed — nothing left to roll back
  }
}
