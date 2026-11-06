"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tidyCompanyNames, undoTidyCompanyNames } from "@/lib/actions/companies";

const SEEN = "careerplatform.applications.companyNamesSeen";
const subscribe = () => () => {};
function readSeen() {
  try { return localStorage.getItem(SEEN); } catch { return null; }
}

/** 「星海！ → 星海」: names older recognition left untidy, one click to fix, with 撤销. */
export function CompanyNameBanner({ pairs }: { pairs: { from: string; to: string }[] }) {
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = pairs.map((pair) => pair.from).join("|");
  // Hidden while the server renders: it can't read this machine's 「不用」.
  const seen = useSyncExternalStore(subscribe, readSeen, () => key);
  if (closed || seen === key || !pairs.length) return null;

  function later() {
    try { localStorage.setItem(SEEN, key); } catch {}
    setClosed(true);
  }
  async function apply() {
    setBusy(true);
    try {
      const done = await tidyCompanyNames(pairs);
      setClosed(true);
      router.refresh();
      if (!done.length) return void toast.message("这些公司名已经有同名记录，没有改动");
      toast.success(`已整理 ${done.length} 个公司名`, {
        action: { label: "撤销", onClick: () => void undoTidyCompanyNames(done).then(() => { toast.success("已改回原来的名字"); router.refresh(); }) },
      });
    } catch {
      toast.error("整理失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="整理公司名" className="surface-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm">
      <Sparkles className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        有 {pairs.length} 个公司名带了多余的字：{pairs.slice(0, 3).map((pair) => `${pair.from} → ${pair.to}`).join("，")}{pairs.length > 3 ? " 等" : ""}
      </p>
      <Button size="sm" disabled={busy} onClick={apply}>{busy ? "整理中…" : "一键改好"}</Button>
      <Button size="sm" variant="ghost" onClick={later}>不用</Button>
    </section>
  );
}
