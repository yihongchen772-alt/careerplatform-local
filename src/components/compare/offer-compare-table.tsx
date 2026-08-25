import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { STAGE_BADGE_VARIANT, STAGE_LABELS } from "@/lib/stage-labels";
import type { ApplicationStage } from "@prisma/client";

export type OfferRow = {
  id: string;
  companyName: string;
  title: string;
  stage: ApplicationStage;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  offerAnnualTotal: number | null;
  commuteMinutes: number | null;
  overtimeNote: string | null;
  growthNote: string | null;
  offerNote: string | null;
  offerDate: string | null;
  decideBy: string | null;
};

/**
 * Offers side by side with one row per dimension, rather than one card per
 * offer. Comparing is the entire point of this page, and cards force the
 * reader to hold "what was the other one's commute again?" in their head
 * while their eyes travel; a shared row puts the two numbers next to each
 * other. Cards remain on narrow screens, where a table can't fit anyway.
 */
export function OfferCompareTable({ offers }: { offers: OfferRow[] }) {
  // "Best" is only meaningful where more/less is unambiguously better —
  // salary and package high, commute low. Overtime and growth are free text
  // and deliberately not ranked: pretending to score "大小周" against
  // "弹性但晚上盯线上" would be inventing a judgement the data can't support.
  const topMonthly = Math.max(0, ...offers.map((o) => o.salaryMax ?? o.salaryMin ?? 0));
  const topAnnual = Math.max(0, ...offers.map((o) => o.offerAnnualTotal ?? 0));
  const commutes = offers.map((o) => o.commuteMinutes).filter((c): c is number => c != null);
  const bestCommute = commutes.length > 0 ? Math.min(...commutes) : null;

  const monthly = (o: OfferRow) =>
    o.salaryMin || o.salaryMax ? `${o.salaryMin ?? "?"}-${o.salaryMax ?? "?"}K` : "—";

  const rows: {
    label: string;
    render: (o: OfferRow) => React.ReactNode;
    best?: (o: OfferRow) => boolean;
  }[] = [
    {
      label: "月薪",
      render: monthly,
      best: (o) => topMonthly > 0 && (o.salaryMax ?? o.salaryMin ?? 0) === topMonthly,
    },
    {
      label: "年包",
      render: (o) => (o.offerAnnualTotal ? `${o.offerAnnualTotal} 万` : "—"),
      best: (o) => topAnnual > 0 && o.offerAnnualTotal === topAnnual,
    },
    { label: "地点", render: (o) => o.location ?? "—" },
    {
      label: "单程通勤",
      render: (o) => (o.commuteMinutes != null ? `${o.commuteMinutes} 分钟` : "—"),
      best: (o) => bestCommute != null && o.commuteMinutes === bestCommute,
    },
    { label: "加班情况", render: (o) => o.overtimeNote ?? "—" },
    { label: "发展空间", render: (o) => o.growthNote ?? "—" },
    { label: "拿到日期", render: (o) => o.offerDate ?? "—" },
    {
      label: "决策截止",
      render: (o) =>
        o.decideBy ? <span className="text-destructive">{o.decideBy}</span> : "—",
    },
    { label: "备注", render: (o) => o.offerNote ?? "—" },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="w-28 p-3 text-left font-medium text-muted-foreground">
              对比维度
            </th>
            {offers.map((o) => (
              <th key={o.id} className="min-w-40 p-3 text-left align-top">
                <Link
                  href={`/applications/${o.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {o.companyName}
                </Link>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                  {o.title}
                </p>
                <Badge variant={STAGE_BADGE_VARIANT[o.stage]} className="mt-1.5">
                  {STAGE_LABELS[o.stage]}
                </Badge>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b last:border-0">
              <th className="p-3 text-left align-top font-normal text-muted-foreground">
                {row.label}
              </th>
              {offers.map((o) => (
                <td key={o.id} className="p-3 align-top">
                  <span className="whitespace-pre-wrap">{row.render(o)}</span>
                  {row.best?.(o) && offers.length > 1 && (
                    <Badge variant="secondary" className="ml-1.5 align-middle">
                      最优
                    </Badge>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
