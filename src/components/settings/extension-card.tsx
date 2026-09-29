"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Copy, FolderOpen, KeyRound, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createExtensionPairing, revokeExtensionPairing, type ExtensionPairing } from "@/lib/actions/extension";

const noop = () => () => {};

/**
 * 浏览器插件: install the bundled Chrome/Edge extension (load unpacked from the
 * folder the app keeps up to date) and pair it with a one-time code. The
 * extension only talks to this app on localhost; nothing goes to a server.
 */
export function ExtensionCard({ initial }: { initial: ExtensionPairing }) {
  const [pairing, setPairing] = useState(initial);
  const [token, setToken] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const desktop = useSyncExternalStore(noop, () => !!window.desktopBridge?.openExtensionFolder, () => false);

  async function generate() {
    if (pairing.paired && !window.confirm("重新生成后，已配对的插件需要重新填写配对码。继续？")) return;
    setBusy(true);
    try {
      const res = await createExtensionPairing();
      if (!res.ok) return void toast.error(res.message);
      setToken(res.data.token);
      setPairing({ paired: true, pairedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await revokeExtensionPairing();
      if (!res.ok) return void toast.error(res.message);
      setToken(null);
      setPairing({ paired: false, pairedAt: null });
      toast.success("已取消配对，插件将无法再读取你的资料");
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    try {
      const { path } = await window.desktopBridge!.openExtensionFolder();
      setFolder(path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开插件文件夹失败");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="size-4" />
          浏览器插件（Chrome / Edge）
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          在平时用的 Chrome 或 Edge 里也能一键填写网申、记为已投递、收藏岗位、设为进度页，和 App 内置的网申浏览器用同一套填写逻辑。资料只从这台电脑上的求职罗盘读取，使用时需要 App 保持打开。
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            点下面的「打开插件文件夹」。
            {desktop && (
              <Button type="button" variant="outline" size="sm" className="ml-2 h-7" onClick={openFolder}>
                <FolderOpen className="size-3.5" />
                打开插件文件夹
              </Button>
            )}
            {folder && (
              <span className="mt-1 block break-all text-xs">
                {folder}
                <span className="block text-muted-foreground">路径已复制。选择文件夹时找不到的话，在对话框里按 ⌘⇧G（Windows 点地址栏）粘贴。</span>
              </span>
            )}
          </li>
          <li>在 Chrome 地址栏打开 chrome://extensions（Edge 是 edge://extensions），打开右上角「开发者模式」。</li>
          <li>点「加载已解压的扩展程序」，选择刚才打开的「求职罗盘浏览器插件」文件夹（在你的个人文件夹里）。</li>
          <li>生成配对码，点浏览器右上角的求职罗盘图标，粘贴配对码并连接。</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          App 更新后插件文件会自动更新；在扩展程序页点一下插件的刷新按钮（或重启浏览器）即可用上新版。
        </p>
        <div className="space-y-2 rounded-md border p-3">
          <p className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {pairing.paired ? `已生成配对码${pairing.pairedAt ? `（${pairing.pairedAt.slice(0, 10)}）` : ""}` : "还没配对"}
          </p>
          {token && (
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{token}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(token);
                  toast.success("配对码已复制");
                }}
              >
                <Copy className="size-3.5" />
                复制
              </Button>
            </div>
          )}
          {token && <p className="text-xs text-muted-foreground">配对码只显示这一次，相当于插件的密码，不要发给别人。</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={generate}>
              {pairing.paired ? "重新生成配对码" : "生成配对码"}
            </Button>
            {pairing.paired && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={revoke}>
                取消配对
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
