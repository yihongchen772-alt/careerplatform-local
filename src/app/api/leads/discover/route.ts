import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { findJobs } from "@/lib/career-ops";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const user = await requireUser();
  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    cities?: unknown;
    includeBoards?: unknown;
    includeSheets?: unknown;
    includeWeb?: unknown;
  };
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 120) : "";
  if (!query) {
    return NextResponse.json({ error: "先输入想找的岗位方向或公司关键词" }, { status: 400 });
  }
  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: { preferredCities: true },
  });
  const defaultCities = (profile?.preferredCities ?? "")
    .split(/[\s,，、/]+/)
    .filter(Boolean);
  const cities = Array.isArray(body.cities)
    ? body.cities.map((c) => String(c).trim()).filter(Boolean).slice(0, 10)
    : typeof body.cities === "string" && body.cities.trim()
    ? body.cities.split(/[\s,，、/]+/).filter(Boolean).slice(0, 10)
    : defaultCities;

  const result = await findJobs(user.id, query, cities, {
    includeBoards: body.includeBoards !== false,
    includeSheets: body.includeSheets !== false,
    includeWeb: body.includeWeb !== false,
  });
  return NextResponse.json(result);
}
