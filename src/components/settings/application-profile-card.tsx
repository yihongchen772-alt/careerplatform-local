"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AiProgress } from "@/components/ui/ai-progress";
import { extractApplicationProfile, updateApplicationProfile } from "@/lib/actions/account";
import {
  EXTRA_FIELDS,
  type ApplicationProfile,
  type EducationRow,
  type ExperienceRow,
} from "@/lib/application-profile";

type ResumeOption = { id: string; name: string };

const emptyEducation: EducationRow = { school: "", major: "", degree: "", gpa: "", start: "", end: "" };
const emptyExperience: ExperienceRow = { company: "", role: "", start: "", end: "", description: "" };

/**
 * The 网申 facts the account profile above doesn't hold and the resume
 * doesn't carry reliably: education rows (专业/学历/GPA/起止 are asked on
 * every form and were previously guessed by AI from the resume each time),
 * experience rows, and the 政治面貌/籍贯/民族 trio no resume mentions.
 * Read by /api/desktop-browser/profile for the keyword matcher.
 */
export function ApplicationProfileCard({
  initial,
  resumeVersions,
}: {
  initial: ApplicationProfile;
  resumeVersions: ResumeOption[];
}) {
  const [profile, setProfile] = useState<ApplicationProfile>(initial);
  const [resumeId, setResumeId] = useState(resumeVersions[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const setEdu = (i: number, patch: Partial<EducationRow>) =>
    setProfile((p) => ({ ...p, education: p.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const setExp = (i: number, patch: Partial<ExperienceRow>) =>
    setProfile((p) => ({ ...p, experiences: p.experiences.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await updateApplicationProfile(profile);
      if (!res.ok) return void toast.error(res.message);
      setProfile(res.data);
      toast.success("网申资料已保存");
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    if (!resumeId || extracting) return;
    setExtracting(true);
    try {
      const res = await extractApplicationProfile(resumeId);
      if (!res.ok) return void toast.error(res.message);
      // Merge: AI rows replace the lists, but hand-typed extras survive.
      setProfile((p) => ({
        education: res.data.education.length ? res.data.education : p.education,
        experiences: res.data.experiences.length ? res.data.experiences : p.experiences,
        extras: { ...res.data.extras, ...Object.fromEntries(Object.entries(p.extras).filter(([, v]) => v)) },
      }));
      toast.success("已从简历里提取，检查一下再保存");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>网申资料</CardTitle>
        <p className="text-sm text-muted-foreground">
          网申表单每次都问的东西：学校/专业/学历/GPA/起止时间、实习经历、政治面貌/籍贯/民族/英语。填在这里，「AI
          一键填充」就直接照抄，不用每次靠 AI 从简历里猜。教育经历把最高学历放第一行。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {resumeVersions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
            <span className="text-sm">从简历自动提取：</span>
            <Select value={resumeId} onValueChange={(v) => v && setResumeId(v)}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue>{(value: string) => resumeVersions.find((r) => r.id === value)?.name ?? "选简历"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {resumeVersions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="secondary" disabled={extracting} onClick={handleExtract}>
              <Sparkles className="size-4" />
              {extracting ? "提取中…" : "提取"}
            </Button>
            <AiProgress active={extracting} expectedSeconds={20} stages={["正在读简历…", "正在整理教育/实习经历…"]} className="w-full space-y-1.5" />
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">教育经历</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setProfile((p) => ({ ...p, education: [...p.education, { ...emptyEducation }] }))}>
              <Plus className="size-4" />
              加一段
            </Button>
          </div>
          {profile.education.length === 0 && <p className="text-xs text-muted-foreground">还没有——点「加一段」或从简历提取。</p>}
          {profile.education.map((e, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6">
              <Field label="学校" className="sm:col-span-2"><Input value={e.school} onChange={(ev) => setEdu(i, { school: ev.target.value })} /></Field>
              <Field label="专业" className="sm:col-span-2"><Input value={e.major} onChange={(ev) => setEdu(i, { major: ev.target.value })} /></Field>
              <Field label="学历"><Input value={e.degree} onChange={(ev) => setEdu(i, { degree: ev.target.value })} placeholder="硕士" /></Field>
              <Field label="GPA"><Input value={e.gpa} onChange={(ev) => setEdu(i, { gpa: ev.target.value })} placeholder="3.8/4.0" /></Field>
              <Field label="入学"><Input value={e.start} onChange={(ev) => setEdu(i, { start: ev.target.value })} placeholder="2025-08" /></Field>
              <Field label="毕业"><Input value={e.end} onChange={(ev) => setEdu(i, { end: ev.target.value })} placeholder="2027-06" /></Field>
              <div className="flex items-end sm:col-span-4 sm:justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => setProfile((p) => ({ ...p, education: p.education.filter((_, j) => j !== i) }))}>
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">实习 / 工作经历</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setProfile((p) => ({ ...p, experiences: [...p.experiences, { ...emptyExperience }] }))}>
              <Plus className="size-4" />
              加一段
            </Button>
          </div>
          {profile.experiences.length === 0 && <p className="text-xs text-muted-foreground">还没有。</p>}
          {profile.experiences.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
              <Field label="单位" className="sm:col-span-2"><Input value={x.company} onChange={(ev) => setExp(i, { company: ev.target.value })} /></Field>
              <Field label="职位" className="sm:col-span-2"><Input value={x.role} onChange={(ev) => setExp(i, { role: ev.target.value })} /></Field>
              <Field label="开始"><Input value={x.start} onChange={(ev) => setExp(i, { start: ev.target.value })} placeholder="2025-06" /></Field>
              <Field label="结束"><Input value={x.end} onChange={(ev) => setExp(i, { end: ev.target.value })} placeholder="2025-09" /></Field>
              <Field label="做了什么" className="sm:col-span-4"><Textarea rows={2} value={x.description} onChange={(ev) => setExp(i, { description: ev.target.value })} /></Field>
              <div className="flex justify-end sm:col-span-4">
                <Button type="button" size="sm" variant="ghost" onClick={() => setProfile((p) => ({ ...p, experiences: p.experiences.filter((_, j) => j !== i) }))}>
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <p className="text-sm font-medium">其他常问字段</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {EXTRA_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  value={profile.extras[f.key] ?? ""}
                  onChange={(ev) => setProfile((p) => ({ ...p, extras: { ...p.extras, [f.key]: ev.target.value } }))}
                  placeholder={f.hint}
                />
              </Field>
            ))}
          </div>
        </section>

        <Button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "保存中…" : "保存网申资料"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
