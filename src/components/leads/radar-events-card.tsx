"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Radar, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { importRadarJobToLeads } from "@/lib/actions/job-radar";

export type RadarEventRow = {
  id: string;
  companyId: string;
  companyName: string;
  careerUrl: string | null;
  title: string;
  type: "NEW" | "UPDATED" | "REMOVED";
  detail: string | null;
  createdAt: string;
  alreadyImported: boolean;
};

const TYPE_LABEL: Record<RadarEventRow["type"], string> = {
  NEW: "新岗位",
  UPDATED: "有更新",
  REMOVED: "已下架",
};

const TYPE_BADGE_VARIANT: Record<RadarEventRow["type"], "default" | "secondary" | "outline"> = {
  NEW: "default",
  UPDATED: "secondary",
  REMOVED: "outline",
};

export function RadarEventsCard({ events }: { events: RadarEventRow[] }) {
  const [imported, setImported] = useState<Set<string>>(
    () => new Set(events.filter((e) => e.alreadyImported).map((e) => e.id))
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  if (events.length === 0) return null;

  async function handleImport(e: RadarEventRow) {
    setBusyId(e.id);
    try {
      const res = await importRadarJobToLeads(e.companyId, e.title);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setImported((prev) => new Set(prev).add(e.id));
      toast.success(res.data.created ? `已把「${e.title}」加进秋招信息库` : "这个岗位已经在秋招信息库里了");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Radar className="size-4" />
          岗位雷达最近检测到的变化
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          AI 从招聘页解析出的具体岗位变化——新出现的岗位可以直接加进秋招信息库，其余的仅供参考
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={TYPE_BADGE_VARIANT[e.type]} className="text-xs">
                  {TYPE_LABEL[e.type]}
                </Badge>
                <span className="font-medium">{e.companyName}</span>
                <span>· {e.title}</span>
              </div>
              {e.detail && e.type !== "REMOVED" && (
                <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleDateString("zh-CN")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {e.type === "NEW" &&
                (imported.has(e.id) ? (
                  <Badge variant="outline" className="text-xs">
                    已导入
                  </Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => handleImport(e)}>
                    {busyId === e.id ? <Loader2 className="size-3 animate-spin" /> : "导入到秋招信息库"}
                  </Button>
                ))}
              {e.careerUrl && (
                <Link
                  href={`/browser?url=${encodeURIComponent(e.careerUrl)}`}
                  className={buttonVariants({ size: "sm", variant: "ghost" })}
                >
                  去看看
                </Link>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
