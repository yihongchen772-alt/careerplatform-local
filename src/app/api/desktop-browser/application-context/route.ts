import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
export async function GET() {
  const user = await requireUser();
  const positions = await db.position.findMany({ where: { userId: user.id }, include: { company: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
  const counts = await db.application.groupBy({ by: ["companyId"], where: { userId: user.id }, _count: true });
  return NextResponse.json({ positions: positions.map((p) => ({ id: p.id, company: p.company.name, title: p.title, url: p.jdUrl, jd: p.jdText, rules: p.applicationRules, submitted: counts.find((c) => c.companyId === p.companyId)?._count || 0 })) });
}
