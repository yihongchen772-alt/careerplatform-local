import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { STAGE_LABELS, POSITION_STATUS_LABELS } from "@/lib/stage-labels";
import { expandSqlTerms } from "@/lib/agent/semantic-search";

export type CommandSearchItem = {
  id: string;
  kind: "application" | "position" | "contact" | "task" | "interview";
  title: string;
  subtitle: string;
  href: string;
};

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 80);
    if (!q) {
      return NextResponse.json({ ok: true, items: [] as CommandSearchItem[] });
    }

    const terms = expandSqlTerms(q, 5);
    const [apps, positions, contacts, tasks] = await Promise.all([
      db.application.findMany({
        where: {
          userId: user.id,
          OR: terms.flatMap((t) => [
            { title: { contains: t } },
            { city: { contains: t } },
            { company: { name: { contains: t } } },
            { company: { aliases: { some: { alias: { contains: t } } } } },
            { stageHistory: { some: { note: { contains: t } } } },
          ]),
        },
        include: { company: { select: { name: true } } },
        orderBy: { currentStageDate: "desc" },
        take: 8,
      }),
      db.position.findMany({
        where: {
          userId: user.id,
          OR: terms.flatMap((t) => [
            { title: { contains: t } },
            { track: { contains: t } },
            { location: { contains: t } },
            { company: { name: { contains: t } } },
          ]),
        },
        include: { company: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      db.contact.findMany({
        where: {
          userId: user.id,
          OR: terms.flatMap((t) => [
            { name: { contains: t } },
            { companyName: { contains: t } },
            { role: { contains: t } },
          ]),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      db.personalTask.findMany({
        where: {
          userId: user.id,
          done: false,
          OR: terms.flatMap((t) => [{ title: { contains: t } }, { note: { contains: t } }]),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const items: CommandSearchItem[] = [
      ...apps.map((a) => ({
        id: `app:${a.id}`,
        kind: "application" as const,
        title: `${a.company.name} · ${a.title}`,
        subtitle: `投递 · ${a.currentStageLabel || STAGE_LABELS[a.currentStage]}${a.city ? ` · ${a.city}` : ""}`,
        href: `/applications/${a.id}`,
      })),
      ...positions.map((p) => ({
        id: `pos:${p.id}`,
        kind: "position" as const,
        title: `${p.company.name} · ${p.title}`,
        subtitle: `候选池 · ${POSITION_STATUS_LABELS[p.status]}${p.location ? ` · ${p.location}` : ""}`,
        href: `/pool?position=${encodeURIComponent(p.id)}`,
      })),
      ...contacts.map((c) => ({
        id: `contact:${c.id}`,
        kind: "contact" as const,
        title: c.name,
        subtitle: `联系人 · ${[c.companyName, c.role].filter(Boolean).join(" · ") || "HR/内推人"}`,
        href: "/contacts",
      })),
      ...tasks.map((t) => ({
        id: `task:${t.id}`,
        kind: "task" as const,
        title: t.title,
        subtitle: `待办${t.dueDate ? ` · 截止 ${t.dueDate.toLocaleDateString("zh-CN")}` : ""}`,
        href: t.applicationId ? `/applications/${t.applicationId}` : "/calendar",
      })),
    ];

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, items: [], error: error instanceof Error ? error.message : "搜索失败" },
      { status: 500 }
    );
  }
}
