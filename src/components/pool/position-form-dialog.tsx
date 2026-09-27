"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AiProgress } from "@/components/ui/ai-progress";
import { createPosition, updatePosition } from "@/lib/actions/positions";
import { findDuplicatePositions } from "@/lib/actions/job-capture";
import { parseJd } from "@/lib/actions/jd-parse";

type FormState = {
  recruitmentType: string;
  companyName: string;
  title: string;
  track: string;
  department: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  jdUrl: string;
  source: string;
  deadline: string;
  techFit: string;
  salary: string;
  location_score: string;
  growth: string;
};

const emptyForm: FormState = {
  recruitmentType: "",
  companyName: "",
  title: "",
  track: "",
  department: "",
  location: "",
  salaryMin: "",
  salaryMax: "",
  jdUrl: "",
  source: "",
  deadline: "",
  techFit: "5",
  salary: "5",
  location_score: "5",
  growth: "5",
};

export type PositionFormInitial = {
  recruitmentType?: string | null;
  companyName: string;
  title: string;
  track: string | null;
  department: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  jdUrl: string | null;
  jdText: string | null;
  source: string | null;
  deadline: string | null;
  scoreBreakdown: {
    techFit?: number;
    salary?: number;
    location?: number;
    growth?: number;
  } | null;
};

function toForm(initial: PositionFormInitial): FormState {
  const b = initial.scoreBreakdown ?? {};
  return {
    recruitmentType: initial.recruitmentType || "",
    companyName: initial.companyName,
    title: initial.title,
    track: initial.track ?? "",
    department: initial.department ?? "",
    location: initial.location ?? "",
    salaryMin: initial.salaryMin != null ? String(initial.salaryMin) : "",
    salaryMax: initial.salaryMax != null ? String(initial.salaryMax) : "",
    jdUrl: initial.jdUrl ?? "",
    source: initial.source ?? "",
    deadline: initial.deadline ? initial.deadline.slice(0, 10) : "",
    techFit: String(b.techFit ?? 5),
    salary: String(b.salary ?? 5),
    location_score: String(b.location ?? 5),
    growth: String(b.growth ?? 5),
  };
}

export function PositionFormDialog({
  mode,
  captureMode = false,
  positionId,
  initial,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  captureMode?: boolean;
  positionId?: string;
  initial?: PositionFormInitial;
  /** Omit when driving `open` from outside (the 网申浏览器's 收藏岗位 flow
   * opens this without any button of its own). A controlled open skips
   * handleOpenChange's reset, so the caller should remount with a fresh
   * `key` whenever it has a new `initial` to show. */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const captureKey = useRef<string | null>(null);
  const attemptedPayload = useRef<string | null>(null);
  const duplicateRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [duplicates, setDuplicates] = useState<Awaited<ReturnType<typeof findDuplicatePositions>>>([]);
  const [duplicateFingerprint, setDuplicateFingerprint] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [jdText, setJdText] = useState(initial?.jdText ?? "");
  const [scoreReason, setScoreReason] = useState("");
  const [form, setForm] = useState<FormState>(
    initial ? toForm(initial) : emptyForm
  );

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      captureKey.current = null; attemptedPayload.current = null; setDuplicates([]); setAllowDuplicate(false);
      setForm(initial ? toForm(initial) : emptyForm);
      setJdText(initial?.jdText ?? "");
      setScoreReason("");
    }
    setOpen(next);
  }

  async function handleParse() {
    if (!jdText.trim() && !form.jdUrl.trim()) {
      toast.error("先粘贴 JD 文字，或填写链接");
      return;
    }
    setParsing(true);
    try {
      const res = await parseJd({ text: jdText, url: form.jdUrl, capture: captureMode });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const parsed = res.data;
      if (parsed.jdText && !jdText.trim()) setJdText(parsed.jdText);
      // Replace rather than merge: this button means "fill from THIS jd", so a
      // field the model couldn't find must clear, not silently keep a value
      // left over from a previous parse in the same dialog.
      setForm((f) => ({
        ...f,
        companyName: parsed.companyName ?? "",
        recruitmentType: parsed.recruitmentType || "",
        deadline: parsed.deadline || "",
        title: parsed.title ?? "",
        location: parsed.location ?? "",
        track: parsed.track ?? "",
        department: parsed.department ?? "",
        salaryMin: parsed.salaryMin != null ? String(parsed.salaryMin) : "",
        salaryMax: parsed.salaryMax != null ? String(parsed.salaryMax) : "",
        techFit: String(Math.round(parsed.techFit)),
        salary: String(Math.round(parsed.salaryScore)),
        location_score: String(Math.round(parsed.locationScore)),
        growth: String(Math.round(parsed.growthScore)),
      }));
      setScoreReason(parsed.scoreReason);
      toast.success("已自动填充并打分，请检查一下再保存");
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    if (!form.companyName || !form.title) {
      toast.error("公司名称和岗位名称必填");
      return;
    }
    saving.current = true;
    setLoading(true);
    try {
      const payload = {
        recruitmentType: (form.recruitmentType || null) as "校招" | "实习" | "社招" | null,
        companyName: form.companyName,
        title: form.title,
        track: form.track || undefined,
        department: form.department || undefined,
        location: form.location || undefined,
        salaryMin: form.salaryMin ? Number(form.salaryMin) : undefined,
        salaryMax: form.salaryMax ? Number(form.salaryMax) : undefined,
        jdUrl: form.jdUrl || undefined,
        // Keep the pasted JD: the resume-match feature compares against it.
        jdText: jdText || undefined,
        source: form.source || undefined,
        deadline: form.deadline ? new Date(form.deadline) : undefined,
        scoreBreakdown: {
          techFit: Number(form.techFit),
          salary: Number(form.salary),
          location: Number(form.location_score),
          growth: Number(form.growth),
        },
      };
      if (mode === "edit" && positionId) {
        await updatePosition(positionId, payload);
        toast.success("已保存修改");
      } else {
        const fingerprint = JSON.stringify([payload.companyName, payload.title, payload.jdUrl]);
        if (!allowDuplicate || fingerprint !== duplicateFingerprint) {
          const matches = await findDuplicatePositions(payload);
          if (matches.length) { setDuplicates(matches); setDuplicateFingerprint(fingerprint); setAllowDuplicate(false); requestAnimationFrame(() => duplicateRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })); return; }
        }
        const payloadText = JSON.stringify(payload);
        if (attemptedPayload.current && attemptedPayload.current !== payloadText) {
          toast.error("上次保存结果尚未确认。请先检查候选池，再修改并重新捕获。");
          return;
        }
        captureKey.current ??= crypto.randomUUID();
        attemptedPayload.current = payloadText;
        await createPosition(payload, captureKey.current);
        toast.success("已添加到候选池");
        setForm(emptyForm);
        setJdText("");
        setScoreReason("");
      }
      setOpen(false);
    } catch {
      toast.error(mode === "edit" ? "保存失败，请重试" : "添加失败，请重试");
    } finally {
      setLoading(false);
      saving.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑候选岗位" : "添加候选岗位"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!!duplicates.length && <div ref={duplicateRef} role="alert" className="space-y-2 rounded border border-amber-500 p-3 text-sm"><p>该岗位可能已经存在：</p>{duplicates.map((p) => <button key={p.id} type="button" className="block text-primary underline" onClick={() => { if (window.desktopProductivity) void window.desktopProductivity.openPosition(p.id); else window.open(`/pool?position=${encodeURIComponent(p.id)}`, "_blank", "noopener"); }}>打开已有岗位：{p.companyName} · {p.title}</button>)}<label className="block"><input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} /> 我已核对，仍然新增</label><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button></div>}
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Field label="粘贴 JD 文字（推荐）">
              <Textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={3}
                placeholder="在招聘页面上复制岗位描述，粘贴到这里"
              />
            </Field>
            <Field label="或填 JD 链接">
              <Input
                value={form.jdUrl}
                onChange={(e) => set("jdUrl", e.target.value)}
                placeholder="https://..."
              />
            </Field>
            <AiProgress active={parsing} expectedSeconds={15} stages={["正在读 JD…", "AI 正在提取字段并按你的偏好打分…"]} />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={parsing}
                onClick={handleParse}
              >
                {parsing ? "解析中..." : "AI 自动填充"}
              </Button>
              <p className="text-xs text-muted-foreground">
                很多招聘网站禁止抓取，链接解析不一定成功，粘文字最稳
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="公司名称 *">
              <Input
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
                required
              />
            </Field>
            <Field label="岗位名称 *">
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                required
              />
            </Field>
            <Field label="方向">
              <Input
                value={form.track}
                onChange={(e) => set("track", e.target.value)}
                placeholder="后端 / 算法 / 产品..."
              />
            </Field>
            <Field label="部门">
              <Input
                value={form.department}
                onChange={(e) => set("department", e.target.value)}
                placeholder="电商事业群 / 云计算部门..."
              />
            </Field>
            <Field label="地点">
              <Input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </Field>
            <Field label="薪资下限（K）">
              <Input
                type="number"
                value={form.salaryMin}
                onChange={(e) => set("salaryMin", e.target.value)}
              />
            </Field>
            <Field label="薪资上限（K）">
              <Input
                type="number"
                value={form.salaryMax}
                onChange={(e) => set("salaryMax", e.target.value)}
              />
            </Field>
            <Field label="招聘类型"><select aria-label="招聘类型" className="w-full rounded border p-2" value={form.recruitmentType} onChange={(e) => set("recruitmentType", e.target.value)}><option value="">未提供</option><option>校招</option><option>实习</option><option>社招</option></select></Field>
            <Field label="渠道">
              <Input
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
                placeholder="官网 / 内推 / 猎头..."
              />
            </Field>
            <Field label="投递截止日期">
              <Input
                type="date"
                value={form.deadline}
                onChange={(e) => set("deadline", e.target.value)}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">打分（0-10，权重：技术35% 薪资25% 地点20% 成长20%）</p>
            {scoreReason && (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                AI 打分依据：{scoreReason}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="技术栈匹配">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.techFit}
                  onChange={(e) => set("techFit", e.target.value)}
                />
              </Field>
              <Field label="薪资">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.salary}
                  onChange={(e) => set("salary", e.target.value)}
                />
              </Field>
              <Field label="地点">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.location_score}
                  onChange={(e) => set("location_score", e.target.value)}
                />
              </Field>
              <Field label="成长性">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.growth}
                  onChange={(e) => set("growth", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
