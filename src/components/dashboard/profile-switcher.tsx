"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  DesktopProfileColor,
  DesktopProfileItem,
  DesktopProfilesState,
} from "@/types/desktop-profiles";

const COLOR_STYLES: Record<
  DesktopProfileColor,
  {
    label: string;
    avatar: string;
    cardActive: string;
    pill: string;
    dot: string;
    swatch: string;
  }
> = {
  blue: {
    label: "海蓝",
    avatar: "bg-blue-500/15 text-blue-600 ring-1 ring-blue-500/25 dark:bg-blue-400/20 dark:text-blue-300",
    cardActive: "border-foreground/[0.08] bg-foreground/[0.035] hover:border-primary/30 hover:bg-foreground/[0.055]",
    pill: "bg-blue-500/12 text-blue-700 dark:bg-blue-400/18 dark:text-blue-300",
    dot: "bg-blue-500",
    swatch: "#3b82f6",
  },
  rose: {
    label: "玫瑰粉",
    avatar: "bg-rose-500/18 text-rose-600 ring-1 ring-rose-500/30 dark:bg-rose-400/22 dark:text-rose-300",
    cardActive:
      "border-rose-500/35 bg-rose-500/[0.08] shadow-[0_2px_12px_-4px_rgba(244,63,94,0.3)] hover:border-rose-500/50 hover:bg-rose-500/[0.12] dark:border-rose-400/35 dark:bg-rose-400/[0.10]",
    pill: "bg-rose-500/15 text-rose-700 dark:bg-rose-400/20 dark:text-rose-200",
    dot: "bg-rose-500",
    swatch: "#f43f5e",
  },
  amber: {
    label: "琥珀金",
    avatar: "bg-amber-500/18 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-400/22 dark:text-amber-300",
    cardActive:
      "border-amber-500/38 bg-amber-500/[0.09] shadow-[0_2px_12px_-4px_rgba(245,158,11,0.28)] hover:border-amber-500/55 hover:bg-amber-500/[0.13] dark:border-amber-400/35 dark:bg-amber-400/[0.10]",
    pill: "bg-amber-500/16 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
    dot: "bg-amber-500",
    swatch: "#f59e0b",
  },
  emerald: {
    label: "翡翠绿",
    avatar: "bg-emerald-500/18 text-emerald-700 ring-1 ring-emerald-500/30 dark:bg-emerald-400/22 dark:text-emerald-300",
    cardActive:
      "border-emerald-500/35 bg-emerald-500/[0.08] shadow-[0_2px_12px_-4px_rgba(16,185,129,0.28)] hover:border-emerald-500/50 hover:bg-emerald-500/[0.12] dark:border-emerald-400/35 dark:bg-emerald-400/[0.10]",
    pill: "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200",
    dot: "bg-emerald-500",
    swatch: "#10b981",
  },
  violet: {
    label: "紫罗兰",
    avatar: "bg-violet-500/18 text-violet-700 ring-1 ring-violet-500/30 dark:bg-violet-400/22 dark:text-violet-300",
    cardActive:
      "border-violet-500/35 bg-violet-500/[0.08] shadow-[0_2px_12px_-4px_rgba(139,92,246,0.28)] hover:border-violet-500/50 hover:bg-violet-500/[0.12] dark:border-violet-400/35 dark:bg-violet-400/[0.10]",
    pill: "bg-violet-500/15 text-violet-800 dark:bg-violet-400/20 dark:text-violet-200",
    dot: "bg-violet-500",
    swatch: "#8b5cf6",
  },
  cyan: {
    label: "晴空青",
    avatar: "bg-cyan-500/18 text-cyan-700 ring-1 ring-cyan-500/30 dark:bg-cyan-400/22 dark:text-cyan-300",
    cardActive:
      "border-cyan-500/35 bg-cyan-500/[0.08] shadow-[0_2px_12px_-4px_rgba(6,182,212,0.28)] hover:border-cyan-500/50 hover:bg-cyan-500/[0.12] dark:border-cyan-400/35 dark:bg-cyan-400/[0.10]",
    pill: "bg-cyan-500/15 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-200",
    dot: "bg-cyan-500",
    swatch: "#06b6d4",
  },
};

const QUICK_NAME_PRESETS: { label: string; color: DesktopProfileColor }[] = [
  { label: "对象", color: "rose" },
  { label: "女朋友", color: "rose" },
  { label: "男朋友", color: "amber" },
  { label: "家人", color: "emerald" },
  { label: "室友", color: "violet" },
];

const SECONDARY_COLOR_OPTIONS: DesktopProfileColor[] = ["rose", "amber", "emerald", "violet", "cyan"];

const noopSubscribe = () => () => {};

function cleanRealName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "我" || trimmed === "me@local") return null;
  return trimmed;
}

function buildFallbackState(userLabel: string): DesktopProfilesState {
  const real = cleanRealName(userLabel);
  const displayName = real ? `我的档案 (${real})` : "我的档案";
  return {
    activeProfileId: "default",
    switching: false,
    profiles: [
      {
        id: "default",
        name: "我的档案",
        color: "blue",
        createdAt: "",
        isDefault: true,
        displayName,
        userRealName: real,
        applicationCount: 0,
        resumeCount: 0,
        aiKeyCount: 0,
        initialized: true,
        browserPartition: "persist:job-application-browser",
      },
    ],
  };
}

function avatarChar(profile: DesktopProfileItem, fallbackRealName: string | null): string {
  const real = profile.userRealName || (profile.isDefault ? fallbackRealName : null);
  const source = profile.isDefault && real ? real : profile.name;
  return (source.trim().slice(0, 1) || "我").toUpperCase();
}

export function ProfileSwitcher({
  userLabel,
  collapsed = false,
}: {
  userLabel: string;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const hasDesktopProfiles = useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== "undefined" && Boolean(window.desktopProfiles),
    () => false
  );

  const [state, setState] = useState<DesktopProfilesState>(() => buildFallbackState(userLabel));
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingBanner, setSwitchingBanner] = useState<{ active: boolean; targetName?: string }>({
    active: false,
  });

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("对象");
  const [newColor, setNewColor] = useState<DesktopProfileColor>("rose");
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<DesktopProfileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [submittingRename, setSubmittingRename] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<DesktopProfileItem | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  // AI key sync loading
  const [syncingKeys, setSyncingKeys] = useState(false);

  const refreshProfiles = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.desktopProfiles : undefined;
    if (!bridge) return;
    try {
      const next = await bridge.list();
      if (next && Array.isArray(next.profiles)) {
        setState(next);
      }
    } catch {
      // Keep existing state on transient IPC errors.
    }
  }, []);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.desktopProfiles : undefined;
    if (!bridge) return;
    let alive = true;

    const syncFromBridge = () => {
      bridge
        .list()
        .then((next) => {
          if (alive && next && Array.isArray(next.profiles)) setState(next);
        })
        .catch(() => {});
    };

    syncFromBridge();
    const offChanged = bridge.onChanged((next) => {
      if (alive && next && Array.isArray(next.profiles)) setState(next);
    });
    const offSwitching = bridge.onSwitching((payload) => {
      if (!alive) return;
      setSwitchingBanner({ active: Boolean(payload?.switching), targetName: payload?.targetName });
      if (payload?.error) {
        toast.error(`切换求职人失败：${payload.error}`);
      }
    });
    const offOpenCreate = bridge.onOpenCreateDialog(() => {
      if (!alive) return;
      setMenuOpen(false);
      setNewName("对象");
      setNewColor("rose");
      setCreateOpen(true);
    });
    window.addEventListener("focus", syncFromBridge);
    return () => {
      alive = false;
      offChanged();
      offSwitching();
      offOpenCreate();
      window.removeEventListener("focus", syncFromBridge);
    };
  }, []);

  // Re-sync summary counts & User.name when navigating across pages (e.g., after saving Settings)
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.desktopProfiles : undefined;
    if (!hasDesktopProfiles || !bridge) return;
    let alive = true;
    bridge
      .list()
      .then((next) => {
        if (alive && next && Array.isArray(next.profiles)) setState(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, userLabel, hasDesktopProfiles]);

  const fallbackReal = useMemo(() => cleanRealName(userLabel), [userLabel]);

  const activeProfile = useMemo(() => {
    const found = state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];
    if (!found) return buildFallbackState(userLabel).profiles[0];
    if (found.id === state.activeProfileId && fallbackReal && !found.userRealName && !found.name.includes(fallbackReal)) {
      return {
        ...found,
        userRealName: fallbackReal,
        displayName: `${found.name} (${fallbackReal})`,
      };
    }
    return found;
  }, [state, fallbackReal, userLabel]);

  const activeStyle = COLOR_STYLES[activeProfile.color] || (activeProfile.isDefault ? COLOR_STYLES.blue : COLOR_STYLES.rose);

  async function handleSwitch(profile: DesktopProfileItem) {
    if (!window.desktopProfiles || profile.id === state.activeProfileId) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(false);
    setSwitchingBanner({ active: true, targetName: profile.displayName || profile.name });
    const res = await window.desktopProfiles.switch(profile.id);
    if (!res.ok) {
      setSwitchingBanner({ active: false });
      toast.error(res.message || "切换档案失败");
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.desktopProfiles) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("请输入求职人称呼或姓名（例如：对象）");
      return;
    }
    setSubmittingCreate(true);
    try {
      setCreateOpen(false);
      setSwitchingBanner({ active: true, targetName: trimmed });
      const res = await window.desktopProfiles.create({
        name: trimmed,
        color: newColor,
        switchImmediately: true,
      });
      if (!res.ok) {
        setSwitchingBanner({ active: false });
        toast.error(res.message || "创建档案失败");
        return;
      }
      toast.success(res.message || `已创建并切换到「${trimmed}」`);
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.desktopProfiles || !renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("档案名称不能为空");
      return;
    }
    setSubmittingRename(true);
    try {
      const res = await window.desktopProfiles.rename(renameTarget.id, trimmed);
      if (!res.ok) {
        toast.error(res.message || "重命名失败");
        return;
      }
      setState(res);
      setRenameTarget(null);
      toast.success("已更新档案名称");
    } finally {
      setSubmittingRename(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!window.desktopProfiles || !deleteTarget) return;
    setSubmittingDelete(true);
    const deletingActive = deleteTarget.id === state.activeProfileId;
    try {
      setDeleteTarget(null);
      if (deletingActive) {
        setSwitchingBanner({ active: true, targetName: "我的档案" });
      }
      const res = await window.desktopProfiles.delete(deleteTarget.id);
      if (!res.ok) {
        setSwitchingBanner({ active: false });
        toast.error(res.message || "删除档案失败");
        return;
      }
      setState(res);
      toast.success(res.message || "已删除求职人档案");
    } finally {
      setSubmittingDelete(false);
    }
  }

  async function handleSyncAiKeys() {
    if (!window.desktopProfiles || syncingKeys) return;
    setSyncingKeys(true);
    try {
      const res = await window.desktopProfiles.syncAiKeys();
      if (res.ok && res.synced > 0) {
        toast.success(res.message || `已同步 ${res.synced} 个 AI 服务密钥`);
      } else if (res.ok) {
        toast.info(res.message || "主档案暂未配置 AI 密钥");
      } else {
        toast.error(res.message || "同步 AI 密钥失败");
      }
      await refreshProfiles();
    } finally {
      setSyncingKeys(false);
    }
  }

  return (
    <>
      {switchingBanner.active && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Loader2 className="size-5 animate-spin" />
            </div>
            <p className="text-[15px] font-semibold text-foreground">
              正在切换至「{switchingBanner.targetName || "目标档案"}」…
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              正在物理隔离简历库、投递看板与内置网申浏览器 Cookie，并自动共享 AI 服务密钥
            </p>
          </div>
        </div>
      )}

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          data-testid="profile-switcher-trigger"
          aria-label={`当前求职人档案：${activeProfile.displayName}，点击切换`}
          title={
            activeProfile.isDefault
              ? `当前求职人：${activeProfile.displayName}（点击切换或新增对象档案）`
              : `当前正在「${activeProfile.displayName}」档案下操作（数据与浏览器登录态已完全隔离）`
          }
          className={cn(
            "group/profile relative flex w-full items-center rounded-xl border text-left transition-all duration-200 outline-none",
            collapsed ? "h-10 justify-center px-0" : "gap-2.5 px-2.5 py-2",
            activeProfile.isDefault ? COLOR_STYLES.blue.cardActive : activeStyle.cardActive
          )}
        >
          <span
            className={cn(
              "relative grid shrink-0 place-items-center rounded-lg text-xs font-bold transition-transform group-hover/profile:scale-105",
              collapsed ? "size-7" : "size-7",
              activeStyle.avatar
            )}
          >
            {avatarChar(activeProfile, fallbackReal)}
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
                activeStyle.dot,
                !activeProfile.isDefault && "animate-pulse"
              )}
            />
          </span>

          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
                    {activeProfile.displayName}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] leading-tight">
                  {activeProfile.isDefault ? (
                    <span className="truncate text-muted-foreground">
                      👥 主档案 · 点此帮对象代投
                    </span>
                  ) : (
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 font-semibold", activeStyle.pill)}>
                      当前代投中 · 独立登录态
                    </span>
                  )}
                </div>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/75 transition-colors group-hover/profile:text-foreground" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start" sideOffset={6} className="w-76 p-2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Users className="size-3.5 text-primary" />
              切换求职人档案
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="size-3" />
              Cookie 物理隔离
            </span>
          </div>

          {!hasDesktopProfiles ? (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              当前处于网页预览模式。在桌面端 App 中打开即可一键创建「对象」档案并热切换独立数据库与网申浏览器登录态。
            </div>
          ) : (
            <>
              <div className="mt-1 space-y-1">
                {state.profiles.map((profile) => {
                  const isCurrent = profile.id === state.activeProfileId;
                  const style = COLOR_STYLES[profile.color] || (profile.isDefault ? COLOR_STYLES.blue : COLOR_STYLES.rose);
                  const display =
                    isCurrent && fallbackReal && !profile.userRealName && !profile.name.includes(fallbackReal)
                      ? `${profile.name} (${fallbackReal})`
                      : profile.displayName;
                  return (
                    <div
                      key={profile.id}
                      className={cn(
                        "group/item flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-all",
                        isCurrent
                          ? "border-primary/35 bg-primary/[0.08]"
                          : "border-transparent hover:border-border/70 hover:bg-accent/60"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSwitch(profile)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
                      >
                        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold", style.avatar)}>
                          {avatarChar(profile, isCurrent ? fallbackReal : null)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">{display}</span>
                            {profile.isDefault && (
                              <span className="shrink-0 rounded bg-foreground/[0.07] px-1 py-0.2 text-[9.5px] font-medium text-muted-foreground">
                                主档案
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                            {profile.initialized
                              ? `${profile.applicationCount} 条投递 · ${profile.resumeCount} 份简历`
                              : "点击首次初始化并自动同步 AI Key"}
                          </span>
                        </span>
                        {isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
                      </button>

                      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/item:opacity-100">
                        <button
                          type="button"
                          aria-label={`重命名 ${profile.name}`}
                          title="重命名档案"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(false);
                            setRenameTarget(profile);
                            setRenameValue(profile.name);
                          }}
                          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                        </button>
                        {!profile.isDefault && (
                          <button
                            type="button"
                            aria-label={`删除 ${profile.name}`}
                            title="删除该求职人档案"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpen(false);
                              setDeleteTarget(profile);
                            }}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/12 hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <DropdownMenuSeparator className="my-1.5" />

              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setNewName("对象");
                    setNewColor("rose");
                    setCreateOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span>新增求职人（如：对象）</span>
                </button>

                {(!activeProfile.isDefault || state.profiles.length > 1) && (
                  <button
                    type="button"
                    disabled={syncingKeys}
                    onClick={() => void handleSyncAiKeys()}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {syncingKeys ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    ) : (
                      <KeyRound className="size-3.5 shrink-0" />
                    )}
                    <span>同步主档案 AI Key（免重复配置）</span>
                  </button>
                )}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create New Profile Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              新增求职人档案
            </DialogTitle>
            <DialogDescription>
              在同一台电脑上帮对象或家人代投简历，数据与各大招聘官网登录态 100% 物理隔离。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cp-new-profile-name" className="text-xs font-medium">
                称呼或姓名
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_NAME_PRESETS.map((preset) => {
                  const selected = newName.trim() === preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setNewName(preset.label);
                        setNewColor(preset.color);
                      }}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all",
                        selected
                          ? "border-primary/60 bg-primary/12 text-primary"
                          : "border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <Input
                id="cp-new-profile-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：对象 / 林小雨"
                maxLength={32}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">醒目徽章配色（防止投错人）</Label>
              <div className="flex flex-wrap gap-2">
                {SECONDARY_COLOR_OPTIONS.map((colorKey) => {
                  const opt = COLOR_STYLES[colorKey];
                  const active = newColor === colorKey;
                  return (
                    <button
                      key={colorKey}
                      type="button"
                      onClick={() => setNewColor(colorKey)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                        active
                          ? "border-foreground/50 bg-accent text-foreground ring-1 ring-foreground/20"
                          : "border-border/70 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: opt.swatch }} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground">新档案自动具备：</p>
              <p>• 独立简历 PDF、投递看板、网申填表记忆与收件箱账号</p>
              <p>• 独立内置浏览器 Cookie 分区（登录字节/腾讯/北森/Moka 绝不串号）</p>
              <p>• 自动共享主档案已配置的 AI Key，免重复配置开箱即用</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submittingCreate}>
                {submittingCreate ? "创建中…" : "创建并立即切换"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Profile Dialog */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名求职人档案</DialogTitle>
            <DialogDescription>修改侧边栏与系统菜单中显示的求职人标识。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cp-rename-profile" className="text-xs font-medium">
                档案名称
              </Label>
              <Input
                id="cp-rename-profile"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={32}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={submittingRename}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Non-Default Profile AlertDialog */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认删除求职人档案「{deleteTarget?.displayName || deleteTarget?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除后，该档案下独立的本地数据库（{deleteTarget?.applicationCount ?? 0} 条投递）、
              简历附件（{deleteTarget?.resumeCount ?? 0} 份）以及内置浏览器登录 Cookie 将被永久清理。
              你的「主档案」数据不受任何影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={submittingDelete}
              onClick={() => void handleDeleteConfirm()}
            >
              {submittingDelete ? "删除中…" : "确认永久删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
