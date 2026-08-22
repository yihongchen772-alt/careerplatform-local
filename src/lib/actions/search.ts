"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchResults = {
  positions: SearchResult[];
  applications: SearchResult[];
  companies: SearchResult[];
};

const EMPTY: GlobalSearchResults = { positions: [], applications: [], companies: [] };

export async function globalSearch(query: string): Promise<GlobalSearchResults> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length < 2) return EMPTY;

  const [positions, applications, companies] = await Promise.all([
    db.position.findMany({
      where: {
        userId: user.id,
        status: { not: "APPLIED" },
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { company: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: { company: true },
      take: 5,
    }),
    db.application.findMany({
      where: {
        userId: user.id,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { company: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: { company: true },
      take: 5,
    }),
    db.company.findMany({
      where: {
        careerUrl: { not: null },
        name: { contains: q, mode: "insensitive" },
      },
      take: 5,
    }),
  ]);

  return {
    positions: positions.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: p.company.name,
      href: "/pool",
    })),
    applications: applications.map((a) => ({
      id: a.id,
      title: a.title,
      subtitle: a.company.name,
      href: `/applications/${a.id}`,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      title: c.name,
      subtitle: c.sector ?? c.industry ?? "",
      href: "/companies",
    })),
  };
}
