"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Globe, KeyRound, Plus, Sparkles, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { copyText } from "@/lib/copy-text";
import { buildBrowserApplyHref } from "@/lib/batch-apply";
import {
  parseReferralPostText,
  type ReferralCodeEntry,
} from "@/lib/referral-vault";
import {
  deleteReferralCode,
  importReferralPostToVaultAndPool,
  saveReferralCode,
} from "@/lib/actions/referral-vault";

export function ReferralVaultCard({ initialCodes }: { initialCodes: ReferralCodeEntry[] }) {
  const router = useRouter();
  const [codes, setCodes] = useState<ReferralCodeEntry[]>(initialCodes);
  const [search, setSearch] = useState("");
  const [showCatcher, setShowCatcher] = useState(false);
  const [rawPost, setRawPost] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [referrer, setReferrer] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const parsed = useMemo(() => (rawPost.trim() ? parseReferralPostText(rawPost) : null), [rawPost]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter((item) =>
      `${item.company} ${item.code} ${item.referrer ?? ""} ${item.note ?? ""}`.toLowerCase().includes(q)
    );
  }, [codes, search]);

  async function handleCopy(item: ReferralCodeEntry) {
    try {
      await copyText(item.code);
      setCopiedId(item.id);
      toast.success(`已复制「${item.company}」内推码：${item.code}`);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500);
    } catch {
      toast.error("复制失败");
    }
  }

  async function handleManualAdd() {
    if (!company.trim() || !code.trim() || busy) return;
    setBusy(true);
    try {
      const res = await saveReferralCode({ company, code, url, referrer });
      if (!res.ok) return void toast.error(res.message);
      setCodes(res.data);
      setCompany("");
      setCode("");
      setUrl("");
      setReferrer("");
      setManualOpen(false);
      toast.success("内推码已存入保险箱，打开该公司网申页会自动识别填入");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportPost(addToPool: boolean) {
    if (!parsed || busy) return;
    if (!parsed.company) {
      toast.error("未能自动识别出公司名，请先在文案开头加上【公司名】");
      return;
    }
    if (!parsed.code && !addToPool) {
      toast.error("这段文案里没识别到内推码，可以点「存内推码 + 入候选池」直接把岗位收进候选池");
      return;
    }
    setBusy(true);
    try {
      const res = await importReferralPostToVaultAndPool({
        company: parsed.company,
        code: parsed.code || undefined,
        url: parsed.url || undefined,
        referrer: parsed.referrer || undefined,
        roles: parsed.roles,
        cities: parsed.cities,
        deadline: parsed.deadline || undefined,
        note: parsed.note,
        addToPool,
      });
      if (!res.ok) return void toast.error(res.message);
      setCodes(res.data.codes);
      setRawPost("");
      setShowCatcher(false);
      toast.success(
        `已完成：${parsed.code ? `存入「${parsed.company}」内推码 ${parsed.code}` : `记录「${parsed.company}」`}${res.data.addedPositions > 0 ? `，并加入 ${res.data.addedPositions} 个岗位到候选池` : ""}`
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    const res = await deleteReferralCode(id);
    if (!res.ok) return void toast.error(res.message);
    setCodes(res.data);
    toast.success("已移除该内推码");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            内推码保险箱 & 群聊文案捕手
            {codes.length > 0 && <Badge variant="secondary">{codes.length}</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            存入对应公司的内推码后，使用内置网申浏览器打开该公司招聘页时会自动匹配填入「内推码/推荐码」。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={showCatcher ? "default" : "outline"} onClick={() => { setShowCatcher((v) => !v); setManualOpen(false); }}>
            <Sparkles className="size-3.5" />
            粘贴群聊内推文案
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setManualOpen((v) => !v); setShowCatcher(false); }}>
            <Plus className="size-3.5" />
            手动存内推码
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showCatcher && (
          <div className="space-y-2.5 rounded-xl border border-primary/25 bg-primary/[0.03] p-3">
            <Textarea
              rows={4}
              value={rawPost}
              onChange={(e) => setRawPost(e.target.value)}
              placeholder="直接粘贴微信群/牛客/小红书的一整段内推文案，例如：【宇树科技】2027 届秋招提前批内推开启！热招岗位：机器人算法、嵌入式软件、C++；城市：上海、杭州；内推码：UNITREE2027；投递链接：https://..."
              className="text-sm"
            />
            {parsed && (
              <div className="space-y-1.5 rounded-lg border bg-card p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">识别预览：</span>
                  <Badge variant={parsed.company ? "default" : "destructive"}>{parsed.company || "未识别公司"}</Badge>
                  {parsed.code && <Badge variant="secondary" className="font-mono">内推码：{parsed.code}</Badge>}
                  {parsed.referrer && <Badge variant="outline">内推人：{parsed.referrer}</Badge>}
                  {parsed.deadline && <Badge variant="outline">截止：{parsed.deadline}</Badge>}
                  {parsed.cities.length > 0 && <Badge variant="outline">{parsed.cities.join(" / ")}</Badge>}
                </div>
                {parsed.roles.length > 0 && (
                  <p className="text-muted-foreground">岗位：{parsed.roles.join("、")}</p>
                )}
                {parsed.url && (
                  <p className="truncate text-primary">{parsed.url}</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!parsed || busy} onClick={() => void handleImportPost(true)}>
                存入内推码 + 加入候选池
              </Button>
              <Button size="sm" variant="outline" disabled={!parsed?.code || busy} onClick={() => void handleImportPost(false)}>
                仅存入内推码保险箱
              </Button>
            </div>
          </div>
        )}

        {manualOpen && (
          <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司名（如 字节跳动）" />
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="内推码（如 6H8K9M）" className="font-mono" />
            <Input value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="内推人（可选）" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="专属投递链接（可选）" />
            <Button disabled={!company.trim() || !code.trim() || busy} onClick={() => void handleManualAdd()}>保存内推码</Button>
          </div>
        )}

        {codes.length > 0 && (
          <>
            {codes.length > 4 && (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜公司名或内推码…"
                className="h-8 max-w-xs text-xs"
              />
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border bg-card/70 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-foreground">{item.company}</span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono font-semibold text-primary">{item.code}</span>
                    </div>
                    <p className="truncate text-muted-foreground">
                      {[item.referrer ? `内推人：${item.referrer}` : null, item.expiresAt ? `截止 ${item.expiresAt}` : null].filter(Boolean).join(" · ") || "网申页自动匹配"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" className="size-7" title="复制内推码" onClick={() => void handleCopy(item)}>
                      {copiedId === item.id ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
                    </Button>
                    {item.url && (
                      <Button size="icon" variant="ghost" className="size-7" title="在网申浏览器打开并自动填表" onClick={() => router.push(buildBrowserApplyHref(item.url!))}>
                        <Globe className="size-3.5 text-primary" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" title="删除" onClick={() => void handleRemove(item.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
