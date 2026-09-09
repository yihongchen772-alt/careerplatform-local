import { z } from "zod";
import { db } from "@/lib/db";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";

// Real company directories run into a directory-wide AI comparison being
// worth less past a certain size — cap it so an established, hundred-plus
// company directory doesn't blow up every import's prompt.
const MAX_CANDIDATES = 300;

const matchesSchema = z.object({
  matches: z.array(
    z.object({ newName: z.string(), matchedName: z.string().nullable() })
  ),
});

type ResolveOptions = {
  /** Whose AI config to use for the alias-detection step. Omit to skip AI
   * matching entirely (falls straight through to exact/alias/create). */
  aiUserId?: string;
  /** Set on a newly-created Company row — only import-positions.ts's bulk
   * flow has historically attributed provenance this way. */
  addedByUserId?: string;
  verified?: boolean;
};

/**
 * Resolves a batch of free-text company names to canonical Company ids in
 * one pass — "DJI", "大疆创新", and "深圳市大疆创新科技有限公司" should all
 * land on the same row instead of each import silently spawning a new
 * duplicate that then shows up as a separate, easy-to-miss entry in the
 * pool/directory. Batched (rather than one resolveCompanyId call per name)
 * so a multi-row import pays for at most one AI call total, not one per row.
 */
export async function resolveCompanyIds(
  rawNames: string[],
  opts: ResolveOptions = {}
): Promise<Map<string, string>> {
  const names = [...new Set(rawNames.map((n) => n.trim()).filter(Boolean))];
  const result = new Map<string, string>();
  if (names.length === 0) return result;

  // 1. Exact match — the common case, no AI involved.
  const exactRows = await db.company.findMany({ where: { name: { in: names } } });
  for (const row of exactRows) result.set(row.name, row.id);

  let unresolved = names.filter((n) => !result.has(n));
  if (unresolved.length === 0) return result;

  // 2. A name this function has already resolved as an alias before.
  const aliasRows = await db.companyAlias.findMany({
    where: { alias: { in: unresolved } },
    select: { alias: true, companyId: true },
  });
  for (const row of aliasRows) result.set(row.alias, row.companyId);

  unresolved = unresolved.filter((n) => !result.has(n));
  if (unresolved.length === 0) return result;

  // 3. AI-assisted check against the existing directory — only pairs with
  // zero string overlap (DJI vs 大疆) actually need this; nothing here
  // pretends plain string similarity could catch those.
  if (opts.aiUserId) {
    const candidates = await db.company.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
    });

    if (candidates.length > 0) {
      try {
        const config = await getUserAiConfig(opts.aiUserId);
        if (config) {
          const raw = await callTextAi({
            config,
            timeoutMs: 30000,
            thinkingBudget: 512,
            prompt: `下面是几个刚出现的公司名称，判断每一个是不是已有公司列表里某一家的别名/英文名/简称/全称变体/子公司——比如"DJI"和"大疆创新"是同一家，"深圳市大疆创新科技有限公司"和"大疆"也是同一家；跟已有列表里任何一家都不是同一家公司的，不要硬凑。

新出现的名称：
${unresolved.map((n) => `- ${n}`).join("\n")}

已有公司列表：
${candidates.map((c) => c.name).join("\n")}

对每个新名称，如果能确定对应已有列表里的某一家，matchedName 填那家公司在列表里的**完整原文名称**（一字不差，直接抄，不要意译或改写）；不确定或者是完全不同的公司，matchedName 填 null，不要瞎猜。`,
            schema: {
              type: "OBJECT",
              properties: {
                matches: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      newName: { type: "STRING" },
                      matchedName: { type: "STRING", nullable: true },
                    },
                    required: ["newName", "matchedName"],
                  },
                },
              },
              required: ["matches"],
            },
          });

          const parsed = matchesSchema.safeParse(raw);
          if (parsed.success) {
            const byName = new Map(candidates.map((c) => [c.name, c.id]));
            for (const m of parsed.data.matches) {
              if (!m.matchedName) continue;
              const companyId = byName.get(m.matchedName);
              if (!companyId) continue; // AI named something not actually in the list — ignore rather than trust it
              result.set(m.newName, companyId);
              // Race-safe: two concurrent resolutions could both decide to
              // record the same alias — the unique constraint on `alias`
              // makes the loser's insert fail harmlessly.
              await db.companyAlias.create({ data: { companyId, alias: m.newName } }).catch(() => {});
            }
          }
        }
      } catch {
        // AI unreachable/misconfigured — fall through to creating new rows
        // rather than blocking the whole import on a best-effort dedup step.
      }
    }
  }

  unresolved = unresolved.filter((n) => !result.has(n));

  // 4. Genuinely new companies.
  for (const name of unresolved) {
    const created = await db.company.create({
      data: {
        name,
        addedByUserId: opts.addedByUserId ?? null,
        verified: opts.verified ?? false,
      },
    });
    result.set(name, created.id);
  }

  return result;
}

export async function resolveCompanyId(
  rawName: string,
  opts: ResolveOptions = {}
): Promise<string> {
  const map = await resolveCompanyIds([rawName], opts);
  const id = map.get(rawName.trim());
  if (!id) throw new Error(`resolveCompanyId: failed to resolve "${rawName}"`);
  return id;
}
