import type { Prisma } from "@prisma/client";
import { memoryContent, memoryIdentity, mergeMemoryContent, sameMemoryEntity, toMemoryView, type MemoryCapture, type MemorySource } from "@/lib/application-memory";

export async function storeApplicationMemories(tx: Prisma.TransactionClient, userId: string, captures: MemoryCapture[], sourceUrl: string) {
  let changed = 0, conflicts = 0;
  // A single transaction serialises capture requests and keeps the library
  // small even if desktop and plugin save the same experience together.
  const rows = await tx.applicationMemory.findMany({ where: { userId } });
  for (const capture of captures) {
    const content = memoryContent(capture.category, capture.content)!;
    const identity = memoryIdentity(capture.category, content);
    const exact = rows.find((row) => row.category === capture.category && row.identity === identity);
    const compatible = rows.filter((row) => row.category === capture.category && sameMemoryEntity(capture.category, row.content as Record<string, string>, content));
    const existing = exact || (compatible.length === 1 ? compatible[0] : null);
    const source: MemorySource = { url: sourceUrl, captureKey: capture.captureKey };
    if (!existing) {
      const created = await tx.applicationMemory.create({ data: { userId, category: capture.category, identity, content, sources: [source], alternatives: [] } });
      rows.push(created); changed++;
      continue;
    }
    const view = toMemoryView(existing)!;
    const merged = mergeMemoryContent(capture.category, view.content, content, view.alternatives, sourceUrl);
    // URLs form a small set; DOM/session capture keys must not add one copy
    // of the same website on every revisit.
    const sources = view.sources.some((entry) => entry.url === sourceUrl) ? view.sources : [...view.sources, source].slice(-10);
    if (JSON.stringify(merged.content) === JSON.stringify(view.content) && JSON.stringify(merged.alternatives) === JSON.stringify(view.alternatives) && sources === view.sources) continue;
    const updated = await tx.applicationMemory.update({ where: { id: existing.id }, data: { identity: memoryIdentity(capture.category, merged.content), content: merged.content, alternatives: merged.alternatives, sources, revision: { increment: 1 } } });
    rows[rows.findIndex((row) => row.id === existing.id)] = updated;
    changed++; if (merged.conflict) conflicts++;
  }
  return { changed, conflicts };
}
