"use client";

import { useState } from "react";
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
import { createPosition, updatePosition } from "@/lib/actions/positions";
import { parseJd } from "@/lib/actions/jd-parse";

type FormState = {
  companyName: string;
  title: string;
  track: string;
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
  companyName: "",
  title: "",
  track: "",
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
  companyName: string;
  title: string;
  track: string | null;
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
    companyName: initial.companyName,
    title: initial.title,
    track: initial.track ?? "",
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
  positionId,
  initial,
  trigger,
}: {
  mode: "create" | "edit";
  positionId?: string;
  initial?: PositionFormInitial;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
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
      const res = await parseJd({ text: jdText, url: form.jdUrl });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const parsed = res.data;
      // Replace rather than merge: this button means "fill from THIS jd", so a
      // field the model couldn't find must clear, not silently keep a value
      // left over from a previous parse in the same dialog.
      setForm((f) => ({
        ...f,
        companyName: parsed.companyName ?? "",
        title: parsed.title ?? "",
        location: parsed.location ?? "",
        track: parsed.track ?? "",
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
    if (!form.companyName || !form.title) {
      toast.error("公司名称和岗位名称必填");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        companyName: form.companyName,
        title: form.title,
        track: form.track || undefined,
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
        await createPosition(payload);
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
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "编辑候选岗位" : "添加候选岗位"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
