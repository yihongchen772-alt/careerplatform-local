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

/**
 * The 资料库 holds more than resumes and screenshots — certificates, slide
 * decks, portfolio archives and past written-test papers all live there, and
 * those arrive as Office files or zips. Kept as a separate list so the
 * resume/JD upload paths, where a .zip would be meaningless, stay narrow.
 */
export const ALLOWED_LIBRARY_MIME = [
  ...ALLOWED_UPLOAD_MIME,
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
  "text/markdown",
];

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/markdown": ".md",
};

export function mimeTypeForExtension(ext: string): string | undefined {
  return Object.entries(EXT_BY_MIME).find(([, e]) => e === ext.toLowerCase())?.[0];
}

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
  const mimeType = mimeTypeForExtension(ext);
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
