"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Radar, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { companyDirectorySectors } from "@/lib/validation";
import { setCompanyRadar, checkSingleCompanyRadar } from "@/lib/actions/job-radar";

export type CompanyDirectoryRow = {
  id: string;
  name: string;
  careerUrl: string;
  sector: string | null;
  industry: string | null;
  verified: boolean;
  radarEnabled: boolean;
  radarLastCheckedAt: Date | null;
  radarLastChangedAt: Date | null;
  radarLastError: string | null;
  radarLastWarning: string | null;
};

function formatCheckedAt(d: Date | null): string {
  if (!d) return "还没检查过";
  return `上次检查：${new Date(d).toLocaleString("zh-CN", { hour12: false })}`;
}

export function CompanyDirectory({ companies: initial }: { companies: CompanyDirectoryRow[] }) {
  const [companies, setCompanies] = useState(initial);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");

  function patch(id: string, next: Partial<CompanyDirectoryRow>) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...next } : c)));
  }

  async function handleToggleRadar(c: CompanyDirectoryRow, enabled: boolean) {
    patch(c.id, { radarEnabled: enabled });
    const res = await setCompanyRadar(c.id, enabled);
    if (!res.ok) {
      toast.error(res.message);
      patch(c.id, { radarEnabled: !enabled });
      return;
    }
    if (enabled) toast.success(`已开启「${c.name}」的招聘页监控`);
  }

  async function handleCheckNow(c: CompanyDirectoryRow) {
    setCheckingId(c.id);
    try {
      const res = await checkSingleCompanyRadar(c.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      patch(c.id, {
        radarLastCheckedAt: new Date(),
        radarLastChangedAt: res.data.changed ? new Date() : c.radarLastChangedAt,
        radarLastError: res.data.error,
        radarLastWarning: res.data.warning,
      });
      if (res.data.error) toast.error(res.data.error);
      else if (res.data.changed) toast.success(`「${c.name}」的招聘页面内容变了，可能有新岗位`);
      else toast.success("检查完成，内容跟上次一样");
    } finally {
      setCheckingId(null);
    }
  }

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesQuery =
        !query ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.industry ?? "").toLowerCase().includes(query.toLowerCase());
      const matchesSector = sectorFilter === "ALL" || c.sector === sectorFilter;
      return matchesQuery && matchesSector;
    });
  }, [companies, query, sectorFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索公司名称或细分行业"
          className="max-w-xs"
        />
        <Select value={sectorFilter} onValueChange={(v) => setSectorFilter(v ?? "ALL")}>
          <SelectTrigger className="w-40">
            <SelectValue>
              {(value: string) => (value === "ALL" ? "全部行业" : value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部行业</SelectItem>
            {companyDirectorySectors.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-2 pt-6">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{c.name}</p>
                {c.verified ? (
                  <Badge>已核实</Badge>
                ) : (
                  <Badge variant="outline">用户添加</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                {c.sector && <span>{c.sector}</span>}
                {c.industry && <span>· {c.industry}</span>}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => window.open(c.careerUrl, "_blank", "noreferrer")}
              >
                去官网投递
              </Button>

              <div className="space-y-1.5 border-t pt-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={c.radarEnabled}
                    onCheckedChange={(checked) => handleToggleRadar(c, checked === true)}
                  />
                  <Radar className="size-3.5 text-muted-foreground" />
                  <span>招聘页监控</span>
                  {c.radarEnabled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-2 text-xs"
                      disabled={checkingId === c.id}
                      onClick={() => handleCheckNow(c)}
                    >
                      {checkingId === c.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        "立即检查"
                      )}
                    </Button>
                  )}
                </label>
                {c.radarEnabled && (
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <p>{formatCheckedAt(c.radarLastCheckedAt)}</p>
                    {c.radarLastChangedAt && (
                      <p>
                        最近一次检测到内容变化：
                        {new Date(c.radarLastChangedAt).toLocaleString("zh-CN", { hour12: false })}
                      </p>
                    )}
                    {c.radarLastError && (
                      <p className="text-destructive">{c.radarLastError}</p>
                    )}
                    {c.radarLastWarning && (
                      <p className="text-amber-600 dark:text-amber-500">{c.radarLastWarning}</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-sm text-muted-foreground">
            没有匹配的公司
          </p>
        )}
      </div>
    </div>
  );
}
