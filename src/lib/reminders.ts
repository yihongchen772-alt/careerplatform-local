import type { ApplicationStage } from "@prisma/client";

const TERMINAL_STAGES: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED"];

const STALE_THRESHOLD_DAYS = 14;
const UPCOMING_DEADLINE_DAYS = 5;

export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function isTerminalStage(stage: ApplicationStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export type StaleApplication = {
  id: string;
  companyName: string;
  title: string;
  currentStage: ApplicationStage;
  daysStale: number;
};

export function findStaleApplications<
  T extends {
    id: string;
    title: string;
    currentStage: ApplicationStage;
    currentStageDate: Date;
    company: { name: string };
  }
>(applications: T[], thresholdDays = STALE_THRESHOLD_DAYS): StaleApplication[] {
  return applications
    .filter((app) => !isTerminalStage(app.currentStage))
    .map((app) => ({
      id: app.id,
      companyName: app.company.name,
      title: app.title,
      currentStage: app.currentStage,
      daysStale: daysSince(app.currentStageDate),
    }))
    .filter((app) => app.daysStale >= thresholdDays)
    .sort((a, b) => b.daysStale - a.daysStale);
}

export type UpcomingDeadline = {
  id: string;
  companyName: string;
  title: string;
  deadline: Date;
  daysLeft: number;
  kind: "position" | "next_step";
};

export function findUpcomingPositionDeadlines<
  T extends {
    id: string;
    title: string;
    deadline: Date | null;
    company: { name: string };
  }
>(positions: T[], withinDays = UPCOMING_DEADLINE_DAYS): UpcomingDeadline[] {
  return positions
    .filter((p): p is T & { deadline: Date } => p.deadline !== null)
    .map((p) => ({
      id: p.id,
      companyName: p.company.name,
      title: p.title,
      deadline: p.deadline,
      daysLeft: daysUntil(p.deadline),
      kind: "position" as const,
    }))
    .filter((p) => p.daysLeft >= 0 && p.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
