"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { companyDirectorySectors } from "@/lib/validation";

export type CompanyDirectoryRow = {
  id: string;
  name: string;
  careerUrl: string;
  sector: string | null;
  industry: string | null;
  verified: boolean;
};

export function CompanyDirectory({ companies }: { companies: CompanyDirectoryRow[] }) {
  const [query, setQuery] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");

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
