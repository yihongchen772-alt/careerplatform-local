"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  defaultHero,
  parseDirections,
  shareCardHtml,
  type HeroMetric,
  type MidSection,
  type ShareStats,
} from "@/lib/share-card";

const STORE_KEY = "share-card-options";
const SCALE = 0.72;

type Saved = { title: string; name: string; cohort: string; directions: string };

// Name, 届 and directions stay between visits; a failing store just means
// the form starts empty.
function readSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return { title: "", name: "", cohort: "", directions: "", ...JSON.parse(raw) };
  } catch {}
  return { title: "", name: "", cohort: "", directions: "" };
}

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (next: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button key={option.value} type="button" size="sm" variant={value === option.value ? "default" : "outline"} onClick={() => onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * 求职战绩卡: one vertical picture of the numbers (投递 / 面试 / Offer, the
 * funnel or the industries) for a chat or a post. Nothing leaves the app —
 * it is saved to 下载 as a PNG.
 */
export function ShareCardDialog({ stats }: { stats: ShareStats }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>({ title: "", name: "", cohort: "", directions: "" });
  const [hero, setHero] = useState<HeroMetric>(() => defaultHero(stats));
  const [section, setSection] = useState<MidSection>("funnel");
  const [showOfferCompanies, setShowOfferCompanies] = useState(false);
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => ({ title: saved.title, name: saved.name, cohort: saved.cohort, directions: parseDirections(saved.directions), hero, section, showOfferCompanies }),
    [saved, hero, section, showOfferCompanies]
  );
  const html = useMemo(() => shareCardHtml(stats, options), [stats, options]);

  function change(patch: Partial<Saved>) {
    const next = { ...saved, ...patch };
    setSaved(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {}
  }

  async function save() {
    setBusy(true);
    try {
      if (window.desktopBridge?.exportDocument) {
        await window.desktopBridge.exportDocument({ format: "png", html, fileName: "求职战绩" });
        toast.success("已保存到「下载」文件夹");
      } else {
        toast.error("请在桌面版里保存图片");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSaved(readSaved());
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline"><Share2 />生成战绩卡</Button>} />
      <DialogContent className="sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>求职战绩卡</DialogTitle>
          <DialogDescription>把投递、面试、Offer 的数字做成一张图，发朋友圈或小红书。图片只保存在你电脑上。</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="share-title">标题</Label>
              <Input id="share-title" value={saved.title} onChange={(e) => change({ title: e.target.value })} placeholder="我的求职战绩" maxLength={20} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="share-name">昵称（可不填）</Label>
                <Input id="share-name" value={saved.name} onChange={(e) => change({ name: e.target.value })} placeholder="小陈" maxLength={16} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-cohort">届别（可不填）</Label>
                <Input id="share-cohort" value={saved.cohort} onChange={(e) => change({ cohort: e.target.value })} placeholder="2027 届" maxLength={10} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-directions">投递方向（可不填，空格隔开）</Label>
              <Input id="share-directions" value={saved.directions} onChange={(e) => change({ directions: e.target.value })} placeholder="硬件 嵌入式 产品" maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label>大数字</Label>
              <Choice
                value={hero}
                onChange={setHero}
                options={[
                  { value: "applied", label: `投递 ${stats.applied}` },
                  { value: "interviewed", label: `面试 ${stats.interviewed}` },
                  { value: "offers", label: `Offer ${stats.offers}` },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>下面展示</Label>
              <Choice
                value={section}
                onChange={setSection}
                options={[
                  { value: "funnel", label: "转化漏斗" },
                  { value: "industry", label: "投递行业" },
                ]}
              />
            </div>
            {stats.offerCompanies.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showOfferCompanies} onChange={(e) => setShowOfferCompanies(e.target.checked)} />
                写出拿到 Offer 的公司名
              </label>
            )}
            <Button onClick={save} disabled={busy} className="w-full">
              <Download />
              {busy ? "保存中…" : "保存图片"}
            </Button>
          </div>
          <div className="mx-auto overflow-hidden rounded-xl border shadow-sm" style={{ width: SHARE_CARD_WIDTH * SCALE, height: SHARE_CARD_HEIGHT * SCALE }}>
            <iframe
              title="战绩卡预览"
              srcDoc={html}
              sandbox=""
              className="block border-0"
              style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, transform: `scale(${SCALE})`, transformOrigin: "top left" }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
