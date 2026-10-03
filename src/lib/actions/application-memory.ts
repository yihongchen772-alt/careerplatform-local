"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError } from "@/lib/action-result";
import { memoryContent, memoryIdentity, memoryValueKey, mergeMemoryContent, toMemoryView, type MemoryCategory } from "@/lib/application-memory";

export async function updateApplicationMemory(id: string, revision: number, input: { content: Record<string, string>; enabled: boolean }) {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.object({ content: z.record(z.string(), z.string().max(10000)), enabled: z.boolean() }).safeParse(input);
    if (!parsed.success || !Number.isInteger(revision)) throw new UserFacingError("经历格式不对");
    const result = await db.$transaction(async (tx) => {
      const row = await tx.applicationMemory.findFirst({ where: { id, userId: user.id } });
      if (!row) throw new UserFacingError("这条经历已不存在");
      if (row.revision !== revision) throw new UserFacingError("这条经历有新修改，请刷新后再保存");
      const content = memoryContent(row.category as MemoryCategory, parsed.data.content);
      const anchor = row.category === "experience" ? "company" : row.category === "education" ? "school" : "name";
      if (!content?.[anchor] && !content?.text) throw new UserFacingError("请填写经历名称或整段原文");
      const identity = memoryIdentity(row.category as MemoryCategory, content);
      if (await tx.applicationMemory.findFirst({ where: { userId: user.id, category: row.category, identity, id: { not: id } } })) throw new UserFacingError("已有同一条经历，请勾选两条记录后合并");
      const view = toMemoryView(row)!;
      // Manual edits are explicit selection of the preferred version. Keep
      // the old version, so trying a different description is reversible.
      const alternatives = view.alternatives.filter((version) => JSON.stringify(version.content) !== JSON.stringify(content));
      if (JSON.stringify(content) !== JSON.stringify(view.content)) alternatives.push({ content: view.content, source: "手动修改前" });
      const updated = await tx.applicationMemory.update({ where: { id }, data: { content, identity, enabled: parsed.data.enabled, alternatives: alternatives.slice(-5), revision: { increment: 1 } } });
      return toMemoryView(updated)!;
    });
    revalidatePath("/settings"); return result;
  });
}

export async function deleteApplicationMemory(id: string, revision: number) {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await db.applicationMemory.deleteMany({ where: { id, userId: user.id, revision } });
    if (!result.count) throw new UserFacingError("这条经历已更新或不存在，请刷新后重试");
    revalidatePath("/settings"); return null;
  });
}

export async function mergeApplicationMemories(items: { id: string; revision: number }[]) {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.array(z.object({ id: z.string().min(1), revision: z.number().int().nonnegative() })).min(2).max(20).safeParse(items);
    if (!parsed.success || new Set(items.map((row) => row.id)).size !== items.length) throw new UserFacingError("请选择至少两条不同的经历");
    const merged = await db.$transaction(async (tx) => {
      const rows = await tx.applicationMemory.findMany({ where: { userId: user.id, id: { in: items.map((item) => item.id) } } });
      if (rows.length !== items.length || rows.some((row) => row.revision !== items.find((item) => item.id === row.id)?.revision)) throw new UserFacingError("所选经历有新修改，请刷新后再合并");
      if (new Set(rows.map((row) => row.category)).size !== 1) throw new UserFacingError("只可合并同一类型的经历");
      if (new Set(rows.map((row) => !!(row.content as Record<string, unknown>).text)).size !== 1) throw new UserFacingError("整段原文不能和拆分的经历合并，请分别保留");
      const primary = toMemoryView(rows.find((row) => row.id === items[0].id)!)!;
      let content = primary.content;
      const collectedVersions = [...primary.alternatives];
      const sources = [...primary.sources];
      for (const row of rows.filter((row) => row.id !== primary.id)) {
        const view = toMemoryView(row)!;
        const next = mergeMemoryContent(primary.category, content, view.content, [], view.sources[0]?.url || "手动合并");
        content = next.content; collectedVersions.push(...next.alternatives, ...view.alternatives);
        for (const source of view.sources) if (!sources.some((entry) => entry.url === source.url)) sources.push(source);
      }
      const versionKey = (value: Record<string, string>) => JSON.stringify(Object.entries(value).filter(([, text]) => text).map(([key, text]) => [key, memoryValueKey(key, text)]).sort(([a], [b]) => a.localeCompare(b)));
      const seen = new Set([versionKey(content)]);
      const alternatives = collectedVersions.filter((version) => { const key = versionKey(version.content); if (seen.has(key)) return false; seen.add(key); return true; });
      if (alternatives.length > 5) throw new UserFacingError("所选经历合并后超过 5 个其他版本，请减少所选记录；内容尚未修改");
      // Removing secondaries first also permits the completed identity to
      // match a row which is being merged away in this transaction.
      await tx.applicationMemory.deleteMany({ where: { id: { in: rows.filter((row) => row.id !== primary.id).map((row) => row.id) }, userId: user.id } });
      return toMemoryView(await tx.applicationMemory.update({ where: { id: primary.id }, data: { content, identity: memoryIdentity(primary.category, content), alternatives, sources: sources.slice(-10), revision: { increment: 1 } } }))!;
    });
    revalidatePath("/settings"); return merged;
  });
}
