"use client";

import { useMemo, useState } from "react";
import { Download, EyeOff, Eye, Flame, GitBranch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ActivityHeatmapData, SankeyData } from "@/lib/insights-visuals";
import { cn } from "@/lib/utils";

type PosterStyle = "apple_light" | "midnight_gold" | "material_blue";

const NODE_META: Record<string, { col: number; color: string }> = {
  "总投递": { col: 0, color: "#3b82f6" },
  "笔试/测评": { col: 1, color: "#6366f1" },
  "初筛待定": { col: 1, color: "#94a3b8" },
  "初筛终止": { col: 1, color: "#f43f5e" },
  "进入面试": { col: 2, color: "#0ea5e9" },
  "笔测待定": { col: 2, color: "#94a3b8" },
  "笔测终止": { col: 2, color: "#f43f5e" },
  "二面/终面": { col: 3, color: "#8b5cf6" },
  "一面待定": { col: 3, color: "#94a3b8" },
  "一面终止": { col: 3, color: "#f43f5e" },
  "拿到 Offer": { col: 4, color: "#10b981" },
  "终面待定": { col: 4, color: "#94a3b8" },
  "终面终止": { col: 4, color: "#f43f5e" },
};

const HEATMAP_CELL = [
  "bg-muted/70",
  "bg-emerald-200 dark:bg-emerald-950",
  "bg-emerald-400 dark:bg-emerald-800",
  "bg-emerald-500 dark:bg-emerald-600",
  "bg-emerald-600 dark:bg-emerald-400",
];

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function CareerReportStudio({
  sankey,
  heatmap,
  topCompanies,
  userLabel,
}: {
  sankey: SankeyData;
  heatmap: ActivityHeatmapData;
  topCompanies: string[];
  userLabel: string;
}) {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [anonymize, setAnonymize] = useState(true);
  const [posterStyle, setPosterStyle] = useState<PosterStyle>("midnight_gold");

  // Compute clean SVG Sankey layout (width 760 x height 270)
  const layout = useMemo(() => {
    const W = 760;
    const H = 260;
    const padX = 20;
    const padY = 18;
    const nodeW = 14;
    const colXs = [padX, 185, 360, 535, W - padX - nodeW];

    // Calculate total inflow/outflow per node
    const inSum = new Map<string, number>();
    const outSum = new Map<string, number>();
    for (const l of sankey.links) {
      outSum.set(l.from, (outSum.get(l.from) ?? 0) + l.value);
      inSum.set(l.to, (inSum.get(l.to) ?? 0) + l.value);
    }

    const activeNodes = Object.keys(NODE_META).filter(
      (name) => (inSum.get(name) ?? 0) > 0 || (outSum.get(name) ?? 0) > 0
    );
    const byCol = new Map<number, { name: string; value: number; color: string }[]>();
    for (const name of activeNodes) {
      const meta = NODE_META[name];
      const value = Math.max(inSum.get(name) ?? 0, outSum.get(name) ?? 0);
      const list = byCol.get(meta.col) ?? [];
      list.push({ name, value, color: meta.color });
      byCol.set(meta.col, list);
    }

    const nodeRects = new Map<string, { x: number; y: number; h: number; value: number; color: string; col: number }>();
    const usableH = H - padY * 2;
    const gap = 14;
    for (const [col, list] of byCol.entries()) {
      const sum = list.reduce((acc, n) => acc + n.value, 0) || 1;
      const avail = Math.max(60, usableH - gap * Math.max(0, list.length - 1));
      let y = padY;
      for (const n of list) {
        const h = Math.max(12, Math.round((n.value / sum) * avail));
        nodeRects.set(n.name, { x: colXs[col], y, h, value: n.value, color: n.color, col });
        y += h + gap;
      }
    }

    const srcCursor = new Map<string, number>();
    const dstCursor = new Map<string, number>();
    const paths = sankey.links
      .map((link) => {
        const src = nodeRects.get(link.from);
        const dst = nodeRects.get(link.to);
        if (!src || !dst) return null;
        const srcH = Math.max(3, (link.value / Math.max(1, outSum.get(link.from) ?? 1)) * src.h);
        const dstH = Math.max(3, (link.value / Math.max(1, inSum.get(link.to) ?? 1)) * dst.h);
        const y0 = src.y + (srcCursor.get(link.from) ?? 0);
        const y1 = dst.y + (dstCursor.get(link.to) ?? 0);
        srcCursor.set(link.from, (srcCursor.get(link.from) ?? 0) + srcH);
        dstCursor.set(link.to, (dstCursor.get(link.to) ?? 0) + dstH);

        const x0 = src.x + nodeW;
        const x1 = dst.x;
        const cx = (x0 + x1) / 2;
        const d = [
          `M ${x0} ${y0}`,
          `C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`,
          `L ${x1} ${y1 + dstH}`,
          `C ${cx} ${y1 + dstH}, ${cx} ${y0 + srcH}, ${x0} ${y0 + srcH}`,
          "Z",
        ].join(" ");

        return {
          key: `${link.from}->${link.to}`,
          ...link,
          d,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return { W, H, nodeW, nodes: [...nodeRects.entries()], paths };
  }, [sankey]);

  // Group heatmap days into week columns (7 rows per column)
  const weeks = useMemo(() => {
    const cols: ActivityHeatmapData["days"][] = [];
    for (let i = 0; i < heatmap.days.length; i += 7) {
      cols.push(heatmap.days.slice(i, i + 7));
    }
    return cols;
  }, [heatmap.days]);

  function downloadBattlePoster() {
    const scale = 2;
    const W = 720;
    const H = 960;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return void toast.error("当前浏览器不支持导出海报");
    ctx.scale(scale, scale);

    // Background theme
    const grad = ctx.createLinearGradient(0, 0, W, H);
    if (posterStyle === "midnight_gold") {
      grad.addColorStop(0, "#0b1020");
      grad.addColorStop(1, "#18142b");
    } else if (posterStyle === "material_blue") {
      grad.addColorStop(0, "#0f2744");
      grad.addColorStop(1, "#1e3a5f");
    } else {
      grad.addColorStop(0, "#f8fafc");
      grad.addColorStop(1, "#eef2ff");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const isLight = posterStyle === "apple_light";
    const fg = isLight ? "#0f172a" : "#f8fafc";
    const muted = isLight ? "#475569" : "#94a3b8";
    const accent = posterStyle === "midnight_gold" ? "#fbbf24" : "#38bdf8";
    const cardBg = isLight ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.06)";
    const border = isLight ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.12)";

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    // Header
    ctx.fillStyle = accent;
    ctx.font = "600 15px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText("JOBCOMPASS · 求职罗盘战报", 48, 66);

    ctx.fillStyle = fg;
    ctx.font = "700 34px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText(anonymize ? "我的校招冲刺战报" : `${userLabel || "我"}的校招战报`, 48, 114);

    ctx.fillStyle = muted;
    ctx.font = "400 15px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText(`统计日期：${new Date().toLocaleDateString("zh-CN")}${anonymize ? " · 已开启匿名脱敏" : ""}`, 48, 146);

    // 4 Hero KPI Cards
    const kpis = [
      { label: "累计投递", value: `${sankey.total}`, sub: "家/岗位" },
      { label: "进入面试", value: `${sankey.interview1Count}`, sub: `进面率 ${pct(sankey.interview1Count, sankey.total)}` },
      { label: "二面 / 终面", value: `${sankey.interview2Count}`, sub: `一面转化 ${pct(sankey.interview2Count, sankey.interview1Count)}` },
      { label: "收获 Offer", value: `${sankey.offerCount}`, sub: `总转化 ${pct(sankey.offerCount, sankey.total)}` },
    ];
    kpis.forEach((kpi, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 48 + col * 320;
      const y = 180 + row * 124;
      roundRect(x, y, 304, 108, 18);
      ctx.fillStyle = cardBg;
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = muted;
      ctx.font = "500 14px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
      ctx.fillText(kpi.label, x + 22, y + 34);

      ctx.fillStyle = idx === 3 ? "#10b981" : fg;
      ctx.font = "700 36px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
      ctx.fillText(kpi.value, x + 22, y + 80);

      ctx.fillStyle = accent;
      ctx.font = "500 13px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
      ctx.fillText(kpi.sub, x + 130, y + 78);
    });

    // Funnel bars block
    roundRect(48, 444, 624, 230, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.font = "600 18px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText("投递漏斗全景", 72, 482);

    const bars = [
      { label: "总投递", val: sankey.total, color: "#3b82f6" },
      { label: "笔试 / 测评", val: sankey.examCount, color: "#6366f1" },
      { label: "进入面试", val: sankey.interview1Count, color: "#0ea5e9" },
      { label: "二面 / 终面", val: sankey.interview2Count, color: "#8b5cf6" },
      { label: "拿到 Offer", val: sankey.offerCount, color: "#10b981" },
    ];
    bars.forEach((b, i) => {
      const y = 508 + i * 31;
      ctx.fillStyle = muted;
      ctx.font = "500 13px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
      ctx.fillText(b.label, 72, y + 14);
      const trackW = 390;
      const barW = sankey.total > 0 ? Math.max(8, Math.round((b.val / sankey.total) * trackW)) : 8;
      roundRect(172, y + 2, trackW, 14, 7);
      ctx.fillStyle = isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.08)";
      ctx.fill();
      roundRect(172, y + 2, barW, 14, 7);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = "600 13px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
      ctx.fillText(`${b.val} (${pct(b.val, sankey.total)})`, 578, y + 14);
    });

    // Persistence & Streak block
    roundRect(48, 696, 624, 168, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.font = "600 18px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText("冲刺节奏与足迹", 72, 734);

    ctx.fillStyle = muted;
    ctx.font = "400 14px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText(
      `近 18 周活跃投递 ${heatmap.activeDays} 天 · 最长连续冲刺 ${heatmap.longestStreak} 天${heatmap.peakDay ? ` · 单日峰值 ${heatmap.peakDay.count} 家` : ""}`,
      72,
      768
    );

    const companyLine = anonymize
      ? `已隐去具体企业名（共覆盖 ${Math.max(topCompanies.length, sankey.total)} 场真实流程）`
      : `核心进展企业：${topCompanies.slice(0, 6).join(" · ") || "持续推进中"}`;
    ctx.fillStyle = accent;
    ctx.font = "500 14px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText(companyLine.slice(0, 48), 72, 804);

    ctx.fillStyle = muted;
    ctx.font = "400 13px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText("每一份用心准备的简历和复盘，都在把好结果拉近一点。", 72, 840);

    // Footer
    ctx.fillStyle = muted;
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    ctx.fillText("Generated locally by 求职罗盘 JobCompass v2.2 · 数据 100% 本地隐私安全", 48, 916);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `求职战报-${new Date().toLocaleDateString("sv-SE")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("高清求职战报 PNG 已保存");
  }

  return (
    <div className="space-y-4">
      {/* Interactive Sankey Funnel + Battle Poster Studio */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div className="space-y-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-4 text-primary" />
              投递流向桑基图（Sankey）& 一键秋招战报海报
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              直观展示从总投递 → 笔试/测评 → 进入面试 → 二面/终面 → Offer 的真实分流与折损；支持一键脱敏导出高清战报长图。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAnonymize((v) => !v)}
              title="开启后战报长图将隐去具体公司名和姓名，方便分享到小红书/朋友圈"
            >
              {anonymize ? <EyeOff className="size-3.5 text-emerald-600" /> : <Eye className="size-3.5" />}
              {anonymize ? "已脱敏" : "显示公司"}
            </Button>
            <select
              aria-label="战报主题风格"
              value={posterStyle}
              onChange={(e) => setPosterStyle(e.target.value as PosterStyle)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="midnight_gold">暗夜黑金海报</option>
              <option value="apple_light">Apple 极简浅色</option>
              <option value="material_blue">深海蓝渐变</option>
            </select>
            <Button size="sm" onClick={downloadBattlePoster}>
              <Download className="size-3.5" />
              导出战报 PNG
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {layout.paths.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border bg-muted/20 p-3">
              <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="h-[260px] w-full min-w-[640px]">
                {layout.paths.map((p) => {
                  const active = hoveredLink === p.key;
                  const dimmed = hoveredLink !== null && !active;
                  return (
                    <path
                      key={p.key}
                      d={p.d}
                      fill={p.color}
                      fillOpacity={active ? 0.58 : dimmed ? 0.12 : 0.3}
                      className="cursor-pointer transition-opacity duration-150"
                      onMouseEnter={() => setHoveredLink(p.key)}
                      onMouseLeave={() => setHoveredLink(null)}
                    >
                      <title>{`${p.from} → ${p.to}：${p.value} 条（占总投递 ${pct(p.value, sankey.total)}）`}</title>
                    </path>
                  );
                })}
                {layout.nodes.map(([name, rect]) => (
                  <g key={name}>
                    <rect x={rect.x} y={rect.y} width={layout.nodeW} height={rect.h} rx={4} fill={rect.color} />
                    <text
                      x={rect.col === 4 ? rect.x - 6 : rect.x + layout.nodeW + 6}
                      y={rect.y + rect.h / 2 + 4}
                      textAnchor={rect.col === 4 ? "end" : "start"}
                      className="fill-foreground text-[11px] font-medium"
                    >
                      {name} ({rect.value})
                    </text>
                  </g>
                ))}
              </svg>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {hoveredLink
                    ? (() => {
                        const hit = sankey.links.find((l) => `${l.from}->${l.to}` === hoveredLink);
                        return hit ? `当前流向：${hit.from} → ${hit.to} 共 ${hit.value} 条（占总投递 ${pct(hit.value, sankey.total)}）` : "";
                      })()
                    : "将鼠标移到任意流带上查看精准分流人数与占比"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3 text-primary" />
                  总进面率 {pct(sankey.interview1Count, sankey.total)} · Offer 率 {pct(sankey.offerCount, sankey.total)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">投递推进到笔试/面试后将自动绘制流向桑基图。</p>
          )}
        </CardContent>
      </Card>

      {/* 18-Week Submission Activity Heatmap */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="size-4 text-orange-500" />
            近 18 周投递活跃热力图
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">近 18 周共投 {heatmap.totalInWindow} 家</Badge>
            <Badge variant="outline">活跃 {heatmap.activeDays} 天</Badge>
            <Badge variant="outline">最长连投 {heatmap.longestStreak} 天</Badge>
            {heatmap.peakDay && <Badge variant="outline">峰值 {heatmap.peakDay.date}（{heatmap.peakDay.count} 家）</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-1">
            <div className="inline-flex gap-1">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-1">
                  {week.map((day) => (
                    <div
                      key={day.date}
                      title={`${day.date}：投递 ${day.count} 家`}
                      className={cn("size-3.5 rounded-[3px] transition-transform hover:scale-125", HEATMAP_CELL[day.level])}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
