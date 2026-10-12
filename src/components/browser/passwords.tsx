"use client";

import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Infobar } from "@/components/browser/infobar";
import type { DesktopBridge, LoginOffer, LoginState, SavedLogin } from "@/types/desktop-bridge";

/**
 * 网申浏览器 saved passwords, Chrome-style: an offer to keep an account after
 * logging in, a key icon by the address bar to fill one, and 密码管理. The
 * passwords themselves stay in the main process; this side only ever sees
 * one when the applicant asks to show it.
 */
export function useSavedLogins(bridge: DesktopBridge | undefined) {
  const [states, setStates] = useState<Record<number, LoginState>>({});
  const [offer, setOffer] = useState<LoginOffer | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const offState = bridge.onLoginState?.(({ tabId, state }) => {
      setStates((previous) => {
        const next = { ...previous };
        if (state) next[tabId] = state;
        else delete next[tabId];
        return next;
      });
    });
    const offOffer = bridge.onLoginOffer?.(setOffer);
    return () => { offState?.(); offOffer?.(); };
  }, [bridge]);
  return { states, offer, clearOffer: () => setOffer(null) };
}

/** The key icon: this site's kept accounts, one click to fill; 密码管理. */
export function PasswordKeyButton({ bridge, tabId, state, onManage }: { bridge: DesktopBridge; tabId: number; state: LoginState; onManage: () => void }) {
  const filled = !!state.filled;
  async function fill(id: string) {
    const result = await bridge.loginFill?.(tabId, id);
    if (!result) return;
    if (result.ok) toast.success(`已填入 ${result.username || "保存的账号"}`);
    else toast.error(result.message ?? "没有填进去");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="保存的密码"
            title={filled ? `已填入保存的账号 ${state.filled}` : state.accounts.length ? `${state.site} 有 ${state.accounts.length} 个保存的账号` : "保存的密码"}
            className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted", filled ? "text-primary" : "text-muted-foreground")}
          />
        }
      >
        <KeyRound className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{state.site} 保存的账号</DropdownMenuLabel>
          {state.accounts.length ? state.accounts.map((account) => (
            <DropdownMenuItem key={account.id} onClick={() => fill(account.id)}>
              <KeyRound className="size-4" />
              <span className="truncate">{account.username || "（没有账号名）"}</span>
              {state.filled === account.username && <span className="ml-auto text-[11px] text-muted-foreground">已填</span>}
            </DropdownMenuItem>
          )) : <DropdownMenuItem disabled>还没有保存这个网站的账号；登录一次后会问你要不要保存</DropdownMenuItem>}
        </DropdownMenuGroup>
        {state.nearby.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>同一平台的其他公司账号</DropdownMenuLabel>
              {state.nearby.slice(0, 6).map((account) => (
                <DropdownMenuItem key={account.id} onClick={() => fill(account.id)}>
                  <span className="truncate">{account.username || "（没有账号名）"}</span>
                  <span className="ml-auto max-w-28 truncate text-[11px] text-muted-foreground">{account.site}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManage}><Settings2 className="size-4" />密码管理…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 「要保存这个网站的密码吗？」 after a login on the current tab. */
export function LoginOfferInfobar({ bridge, offer, onDone }: { bridge: DesktopBridge; offer: LoginOffer; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const who = offer.username || "这个账号";
  return (
    <Infobar
      tone="info"
      icon={<KeyRound />}
      onClose={() => { void bridge.loginDismiss?.(offer.tabId); onDone(); }}
      closeLabel="这次不保存"
      actions={<>
        {!offer.update && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={async () => { await bridge.loginNever?.(offer.tabId); onDone(); toast.success(`不再询问 ${offer.site} 的密码，可在「密码管理」里改回`); }}>
            这个网站不再询问
          </Button>
        )}
        <Button
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await bridge.loginSave?.(offer.tabId);
              if (!result) return;
              if (result.ok) toast.success(offer.update ? "密码已更新" : `已保存，下次打开 ${offer.site} 会自动填写`);
              else toast.error(result.message ?? "没有保存成功");
              onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          {offer.update ? "更新密码" : "保存密码"}
        </Button>
      </>}
    >
      {offer.update
        ? <>你在 <strong className="font-medium">{offer.site}</strong> 用了新密码登录 <strong className="font-medium">{who}</strong>，要更新保存的密码吗？</>
        : <>要保存 <strong className="font-medium">{who}</strong> 在 <strong className="font-medium">{offer.site}</strong> 的密码吗？下次登录自动填写，只加密存在这台电脑上。</>}
    </Infobar>
  );
}

/** 密码管理: every kept account, shown only on a click; sites never asked about. */
export function PasswordManagerDialog({ bridge, open, onOpenChange }: { bridge: DesktopBridge; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<{ logins: SavedLogin[]; never: { realm: string; site: string }[] } | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const hide = (id: string) => setShown((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void bridge.logins?.().then((value) => { if (alive) setData(value); });
    return () => { alive = false; };
  }, [bridge, open]);

  async function refresh() {
    setData((await bridge.logins?.()) ?? null);
  }

  const term = query.trim().toLowerCase();
  const logins = (data?.logins ?? []).filter((login) => !term || login.site.toLowerCase().includes(term) || login.username.toLowerCase().includes(term));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setShown({}); setConfirming(null); setQuery(""); } onOpenChange(next); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>密码管理</DialogTitle>
          <DialogDescription>网申浏览器里保存的网站账号。密码加密存在这台电脑上，不会上传、同步，也不进数据备份；查看时 Mac 会先要 Touch ID。</DialogDescription>
        </DialogHeader>
        {!bridge.logins ? (
          <p className="text-sm text-muted-foreground">请更新到最新版的求职罗盘桌面 App。</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">正在读取…</p>
        ) : (
          <div className="space-y-4">
            {data.logins.length > 4 && (
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜网站或账号" aria-label="搜索保存的密码" className="h-8 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40" />
            )}
            {logins.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{data.logins.length ? "没有匹配的账号" : "还没有保存的密码。在网申浏览器里登录网站后，会问你要不要保存。"}</p>
            ) : (
              <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-xl border">
                {logins.map((login) => (
                  <li key={login.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={login.site}>{login.site}</p>
                      <p className="truncate text-xs text-muted-foreground">{login.username || "（没有账号名）"}</p>
                    </div>
                    <code className="min-w-24 rounded bg-muted px-2 py-0.5 text-xs">{shown[login.id] ?? "••••••••"}</code>
                    <Button size="icon-sm" variant="ghost" aria-label={shown[login.id] ? "隐藏密码" : "显示密码"} title={shown[login.id] ? "隐藏" : "显示"} onClick={async () => {
                      if (shown[login.id] !== undefined) { hide(login.id); return; }
                      const result = await bridge.loginReveal?.(login.id);
                      if (!result?.ok || result.password === undefined) return void toast.error(result?.message ?? "没有显示");
                      setShown((previous) => ({ ...previous, [login.id]: result.password! }));
                      // Back to dots after a while, like Chrome.
                      setTimeout(() => hide(login.id), 30_000);
                    }}>{shown[login.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
                    <Button size="icon-sm" variant="ghost" aria-label="复制密码" title="复制密码（1 分钟后从剪贴板清掉）" onClick={async () => {
                      const result = await bridge.loginCopy?.(login.id);
                      if (result?.ok) toast.success("已复制密码，1 分钟后自动从剪贴板清掉");
                      else toast.error(result?.message ?? "复制失败");
                    }}><Copy className="size-4" /></Button>
                    {confirming === login.id ? (
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={async () => { await bridge.loginDelete?.(login.id); setConfirming(null); await refresh(); toast.success("已删除"); }}>确认删除</Button>
                    ) : (
                      <Button size="icon-sm" variant="ghost" aria-label="删除这个账号" title="删除" onClick={() => setConfirming(login.id)}><Trash2 className="size-4" /></Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.never.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">不再询问保存密码的网站</p>
                <ul className="flex flex-wrap gap-1.5">
                  {data.never.map((entry) => (
                    <li key={entry.realm} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                      {entry.site}
                      <button type="button" className="text-primary hover:underline" onClick={async () => { await bridge.loginNeverRemove?.(entry.realm); await refresh(); }}>恢复询问</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
