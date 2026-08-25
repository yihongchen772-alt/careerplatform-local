"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateAppSettings } from "@/lib/actions/app-settings";
import { SCAN_INTERVAL_OPTIONS, type AppSettings } from "@/lib/app-settings-shared";

export function BackgroundReminderCard({ initial }: { initial: AppSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function set(next: Partial<AppSettings>) {
    const optimistic = { ...settings, ...next };
    setSettings(optimistic);
    setSaving(true);
    try {
      const res = await updateAppSettings(next);
      if (!res.ok) {
        toast.error(res.message);
        setSettings(settings);
        return;
      }
      setSettings(res.data);
      toast.success("已保存，重启 App 后生效");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>后台提醒</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          默认情况下，提醒只在你打开 App 时检查一次——App 没开就不会提醒。打开下面两项后，
          App 会常驻在菜单栏/任务栏托盘里定时检查（每 30 分钟），有当天到期或已过期的事项时弹
          系统通知。
        </p>

        <label className="flex items-start gap-2 rounded-md border p-3">
          <Checkbox
            className="mt-0.5"
            checked={settings.backgroundReminders}
            disabled={saving}
            onCheckedChange={(c) => set({ backgroundReminders: c === true })}
          />
          <span className="text-sm">
            <span className="font-medium">常驻托盘，定时提醒</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              开启后关闭窗口不会退出 App，而是缩到托盘继续跑。要真正退出请用托盘菜单里的
              「退出」。同一件事只提醒一次，不会反复打扰。
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-md border p-3">
          <Checkbox
            className="mt-0.5"
            checked={settings.autoLaunch}
            disabled={saving || !settings.backgroundReminders}
            onCheckedChange={(c) => set({ autoLaunch: c === true })}
          />
          <span className="text-sm">
            <span className="font-medium">开机自动启动</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              开机后自动在托盘里启动（不弹窗口）。需要先开上面那项——不常驻的话，开机启动
              也只是打开一次就没了，起不到提醒作用。
            </span>
          </span>
        </label>

        <div className="space-y-1 rounded-md border p-3">
          <p className="text-sm font-medium">收件箱扫描频率</p>
          <p className="text-xs text-muted-foreground">
            开了「常驻托盘」之后，收件箱可以定时扫，不用等下次打开 App。每次扫描都会调用一次
            AI 判断邮件类型，所以别设太频繁。
          </p>
          <Select
            value={String(settings.inboxScanIntervalHours ?? 0)}
            onValueChange={(v) => v && set({ inboxScanIntervalHours: Number(v) })}
          >
            <SelectTrigger className="mt-1 w-full sm:w-64" disabled={saving || !settings.backgroundReminders}>
              <SelectValue>
                {() =>
                  SCAN_INTERVAL_OPTIONS.find(
                    (o) => o.value === (settings.inboxScanIntervalHours ?? 0)
                  )?.label ?? "只在打开 App 时扫一次"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SCAN_INTERVAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!settings.backgroundReminders && (
            <p className="text-xs text-muted-foreground">
              需要先打开上面的「常驻托盘」——App 不在后台跑就没人执行定时扫描。
            </p>
          )}
        </div>

        {settings.autoLaunchFailed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            上次启动时系统拒绝了开机自启的设置（这个 App 没有做代码签名，macOS
            和部分 Windows 策略会拦）。可以手动加：Mac 在「系统设置 → 通用 →
            登录项」里添加本 App；Windows 把快捷方式放进「启动」文件夹。
            常驻托盘那项不受影响，照常工作。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
