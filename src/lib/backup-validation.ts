import { Prisma } from "@prisma/client";
import { TABLES, BACKUP_VERSION } from "@/lib/backup-core";
import { MAX_BACKUP_BYTES, MAX_BACKUP_FILE_BYTES, referencedBackupFiles, validBackupFilename } from "@/lib/backup-files";
import { UserFacingError } from "@/lib/action-result";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(detail: string): never { throw new UserFacingError(`备份校验失败：${detail}，未修改现有数据`); }

/** Validate the entire input before file writes or destructive transactions. Older
 * backups may omit later feature tables; the original core tables are mandatory. */
export function parseBackup(json: string): { data: Record<string, Record<string, unknown>[]>; files: Record<string, string>; exportedAt: string } {
  if (Buffer.byteLength(json) > MAX_BACKUP_BYTES) invalid("文件超过 256MB");
  let obj: unknown;
  try { obj = JSON.parse(json); } catch { invalid("JSON 格式不正确"); }
  if (!record(obj) || obj.backupVersion !== BACKUP_VERSION) invalid("备份版本不支持");
  if (typeof obj.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(obj.exportedAt) || !Number.isFinite(Date.parse(obj.exportedAt))) invalid("缺少有效导出时间");
  if (!record(obj.data)) invalid("缺少数据表");
  const data = obj.data;
  for (const table of ["user", "company", "position", "application", "resumeVersion"]) if (!Array.isArray(data[table])) invalid(`缺少 ${table} 数据表`);
  if ((data.user as unknown[]).length !== 1) invalid("必须包含且仅包含一个用户");
  const cleaned: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(data)) {
    if (!(TABLES as readonly string[]).includes(table)) invalid(`未知数据表 ${table}，请使用兼容版本`);
    if (!Array.isArray(rows)) invalid(`${table} 必须为数组`);
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === table);
    if (!model) invalid(`不支持的数据表 ${table}`);
    const fields = model.fields.filter((f) => f.kind !== "object");
    const ids = new Set<string>();
    cleaned[table] = rows.map((row, index) => {
      const where = `${table} 第 ${index + 1} 行`;
      if (!record(row) || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) invalid(`${where} 缺少或重复 ID`);
      ids.add(row.id);
      for (const key of Object.keys(row)) if (!fields.some((f) => f.name === key)) invalid(`${where} 未知字段 ${key}`);
      for (const field of fields) {
        const value = row[field.name];
        if (value === undefined) {
          if (field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt) invalid(`${where} 缺少 ${field.name}`);
          continue;
        }
        if (value === null) { if (field.isRequired) invalid(`${where} 的 ${field.name} 不能为空`); continue; }
        let valid = true;
        if (field.kind === "enum") valid = Prisma.dmmf.datamodel.enums.find((e) => e.name === field.type)?.values.some((v) => v.name === value) ?? false;
        else switch (field.type) {
          case "String": valid = typeof value === "string"; break;
          case "Boolean": valid = typeof value === "boolean"; break;
          case "Int": valid = typeof value === "number" && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647; break;
          case "Float": valid = typeof value === "number" && Number.isFinite(value); break;
          case "DateTime": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); break;
          case "Json": break;
          default: valid = false;
        }
        if (!valid) invalid(`${where} 的 ${field.name} 类型不正确`);
      }
      return row;
    });
  }
  if (obj.files !== undefined && !record(obj.files)) invalid("附件必须为对象");
  const files: Record<string, string> = Object.create(null);
  let total = 0;
  for (const [name, b64] of Object.entries(obj.files ?? {})) {
    if (!validBackupFilename(name) || typeof b64 !== "string" || (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || Buffer.from(b64, "base64").toString("base64") !== b64)) invalid(`附件 ${name} 的名称或 Base64 内容不正确`);
    const size = Buffer.byteLength(b64, "base64");
    if (size > MAX_BACKUP_FILE_BYTES || (total += size) > MAX_BACKUP_BYTES * 0.75) invalid("附件大小超出限制（单个 50MB，总计 192MB）");
    files[name] = b64;
  }
  for (const name of referencedBackupFiles(cleaned)) if (!(name in files)) invalid(`缺少被引用的附件 ${name}`);
  return { data: cleaned, files, exportedAt: obj.exportedAt };
}
