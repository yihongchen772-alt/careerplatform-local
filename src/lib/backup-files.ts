import path from "path";
import { mimeTypeForExtension } from "@/lib/local-storage";
import { UserFacingError } from "@/lib/action-result";

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 50 * 1024 * 1024;
export const FILE_FIELDS = { resumeVersion: "fileUrl", attachment: "url" } as const;
export function validBackupFilename(name: string): boolean {
  return !!name && name.length <= 240 && !/[\\/\x00-\x1f:*?"<>|]/.test(name) && !name.includes("..") && !name.startsWith(".") && !!mimeTypeForExtension(path.extname(name));
}
export function storedBackupFilename(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/api/files/")) return null;
  const name = url.slice("/api/files/".length);
  if (!validBackupFilename(name)) throw new UserFacingError("备份包含不安全的本地附件路径");
  return name;
}
export function referencedBackupFiles(data: Record<string, unknown[]>): Set<string> {
  const names = new Set<string>();
  for (const [table, field] of Object.entries(FILE_FIELDS)) {
    for (const row of data[table] ?? []) {
      const name = storedBackupFilename((row as Record<string, unknown>)[field]);
      if (name) names.add(name);
    }
  }
  return names;
}
