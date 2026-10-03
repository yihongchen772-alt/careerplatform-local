"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, Sparkles, Trash2 } from "lucide-react";
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
  type ProjectRow,
  type AwardRow,
  type ProfileVariant,
} from "@/lib/application-profile";
import { mergeFactRows } from "@/lib/application-memory";

type ResumeOption = { id: string; name: string };

const emptyEducation: EducationRow = { school: "", major: "", degree: "", gpa: "", start: "", end: "" };
const emptyExperience: ExperienceRow = { company: "", role: "", start: "", end: "", description: "" };
const emptyProject: ProjectRow = { name: "", role: "", start: "", end: "", description: "", responsibilities: "" };
const emptyAward: AwardRow = { name: "", issuer: "", level: "", date: "", description: "" };

/**
 * The 网申 facts the account profile above doesn't hold and the resume
 * doesn't carry reliably: education rows (专业/学历/GPA/起止 are asked on
 * every form and were previously guessed by AI from the resume each time),
 * experience and project rows, plus facts such as 政治面貌/籍贯/民族.
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

  // "default" = the base profile; otherwise the id of the 资料方案 being edited.
  // Education is shared; experiences/projects/extras belong to the active one.
  const [active, setActive] = useState("default");
  const activeVariant = profile.variants.find((v) => v.id === active) ?? null;
  type Directional = Pick<ApplicationProfile, "experiences" | "projects" | "extras">;
  const view: Directional = activeVariant ?? profile;
  const setView = (update: (current: Directional) => Directional) =>
    setProfile((p) => {
      const variant = p.variants.find((v) => v.id === active);
      if (!variant) return { ...p, ...update(p) };
      return { ...p, variants: p.variants.map((v) => (v.id === active ? { ...v, ...update(v) } : v)) };
    });

  const setEdu = (i: number, patch: Partial<EducationRow>) =>
    setProfile((p) => ({ ...p, education: p.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const setExp = (i: number, patch: Partial<ExperienceRow>) =>
    setView((v) => ({ ...v, experiences: v.experiences.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const setProject = (i: number, patch: Partial<ProjectRow>) =>
    setView((v) => ({ ...v, projects: v.projects.map((project, j) => (j === i ? { ...project, ...patch } : project)) }));

  function addVariant() {
    if (profile.variants.length >= 8) return void toast.error("最多 8 套方案");
    const source = activeVariant ?? profile;
    const variant: ProfileVariant = {
      id: `v${Date.now().toString(36)}`,
      name: `方案 ${profile.variants.length + 1}`,
      resumeVersionId: null,
      experiences: source.experiences.map((x) => ({ ...x })),
      projects: source.projects.map((x) => ({ ...x })),
      extras: { ...source.extras },
    };
    setProfile((p) => ({ ...p, variants: [...p.variants, variant] }));
    setActive(variant.id);
    toast.info("已复制当前资料为新方案，改名并调整后记得保存");
  }

  const setVariant = (patch: Partial<ProfileVariant>) =>
    setProfile((p) => ({ ...p, variants: p.variants.map((v) => (v.id === active ? { ...v, ...patch } : v)) }));

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
      // Keep hand-typed rows when the resume does not contain that section.
      setProfile((p) => ({ ...p, education: mergeFactRows("education", p.education, res.data.education, 10), awards: mergeFactRows("award", p.awards, res.data.awards, 30) }));
      setView((v) => ({
        experiences: mergeFactRows("experience", v.experiences, res.data.experiences, 20),
        projects: mergeFactRows("project", v.projects, res.data.projects, 20),
        extras: { ...res.data.extras, ...Object.fromEntries(Object.entries(v.extras).filter(([, value]) => value)) },
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
          学校、实习、项目、获奖和其他常问信息都可以在这里维护。一键填充优先使用这些事实，再补充经历记忆库。把最常使用的经历放在前面。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm">资料方案：</span>
            {[{ id: "default", name: "默认资料" }, ...profile.variants].map((v) => (
              <Button key={v.id} type="button" size="sm" variant={active === v.id ? "secondary" : "ghost"} className="h-7" onClick={() => setActive(v.id)}>
                {v.name}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={addVariant} title="按不同求职方向保存不同的实习/项目顺序和常问字段">
              <Copy className="size-3.5" />
              复制为新方案
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            投不同方向（比如数据 / 产品）时，可以各存一套实习、项目顺序、期望岗位、自我评价和其他常问字段；教育经历所有方案共用。网申浏览器里选方案，或给方案绑定一份简历、选简历时自动切换。
          </p>
          {activeVariant && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="方案名称"><Input className="h-8 w-40" value={activeVariant.name} onChange={(ev) => setVariant({ name: ev.target.value })} /></Field>
              <Field label="绑定简历（可选）">
                <Select value={activeVariant.resumeVersionId || "none"} onValueChange={(v) => setVariant({ resumeVersionId: v && v !== "none" ? v : null })}>
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue>{(value: string) => resumeVersions.find((r) => r.id === value)?.name ?? "不绑定"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不绑定</SelectItem>
                    {resumeVersions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-destructive"
                onClick={() => {
                  setProfile((p) => ({ ...p, variants: p.variants.filter((v) => v.id !== active) }));
                  setActive("default");
                }}
              >
                <Trash2 className="size-4" />
                删除此方案
              </Button>
            </div>
          )}
        </div>
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
            <AiProgress active={extracting} expectedSeconds={20} stages={["正在读简历…", "正在整理教育/实习/项目经历…"]} className="w-full space-y-1.5" />
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">教育经历{activeVariant ? "（所有方案共用）" : ""}</p>
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
            <p className="text-sm font-medium">项目经历{activeVariant ? `（${activeVariant.name}）` : ""}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, projects: [...v.projects, { ...emptyProject }] }))}>
              <Plus className="size-4" />
              加一个项目
            </Button>
          </div>
          {view.projects.length === 0 && <p className="text-xs text-muted-foreground">还没有——可以手动添加，也可以从简历提取。</p>}
          {view.projects.map((project, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
              <Field label="项目名称" className="sm:col-span-2"><Input value={project.name} onChange={(ev) => setProject(i, { name: ev.target.value })} /></Field>
              <Field label="我的角色" className="sm:col-span-2"><Input value={project.role} onChange={(ev) => setProject(i, { role: ev.target.value })} placeholder="项目负责人 / 核心成员" /></Field>
              <Field label="开始"><Input value={project.start} onChange={(ev) => setProject(i, { start: ev.target.value })} placeholder="2025-06" /></Field>
              <Field label="结束"><Input value={project.end} onChange={(ev) => setProject(i, { end: ev.target.value })} placeholder="2025-09" /></Field>
              <Field label="项目描述" className="sm:col-span-4"><Textarea rows={2} value={project.description} onChange={(ev) => setProject(i, { description: ev.target.value })} placeholder="项目背景、目标、做了什么" /></Field>
              <Field label="个人职责与成果" className="sm:col-span-4"><Textarea rows={3} value={project.responsibilities} onChange={(ev) => setProject(i, { responsibilities: ev.target.value })} placeholder="你具体负责什么，取得了什么结果" /></Field>
              <div className="flex justify-end sm:col-span-4">
                <Button type="button" size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, projects: v.projects.filter((_, j) => j !== i) }))}>
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">实习 / 工作经历{activeVariant ? `（${activeVariant.name}）` : ""}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, experiences: [...v.experiences, { ...emptyExperience }] }))}>
              <Plus className="size-4" />
              加一段
            </Button>
          </div>
          {view.experiences.length === 0 && <p className="text-xs text-muted-foreground">还没有。</p>}
          {view.experiences.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
              <Field label="单位" className="sm:col-span-2"><Input value={x.company} onChange={(ev) => setExp(i, { company: ev.target.value })} /></Field>
              <Field label="职位" className="sm:col-span-2"><Input value={x.role} onChange={(ev) => setExp(i, { role: ev.target.value })} /></Field>
              <Field label="开始"><Input value={x.start} onChange={(ev) => setExp(i, { start: ev.target.value })} placeholder="2025-06" /></Field>
              <Field label="结束"><Input value={x.end} onChange={(ev) => setExp(i, { end: ev.target.value })} placeholder="2025-09" /></Field>
              <Field label="做了什么" className="sm:col-span-4"><Textarea rows={2} value={x.description} onChange={(ev) => setExp(i, { description: ev.target.value })} /></Field>
              <div className="flex justify-end sm:col-span-4">
                <Button type="button" size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, experiences: v.experiences.filter((_, j) => j !== i) }))}>
                  <Trash2 className="size-4" />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between"><p className="text-sm font-medium">获奖情况（所有方案共用）</p><Button size="sm" variant="outline" disabled={profile.awards.length >= 30} onClick={() => setProfile((p) => ({ ...p, awards: [...p.awards, { ...emptyAward }] }))}><Plus className="size-4" />添加奖项</Button></div>
          {profile.awards.map((award, i) => <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            {([["name", "奖项名称"], ["issuer", "颁发单位"], ["level", "等级"], ["date", "获奖时间"]] as const).map(([key, label]) => <Field key={key} label={label}><Input value={award[key]} onChange={(event) => setProfile((p) => ({ ...p, awards: p.awards.map((item, j) => j === i ? { ...item, [key]: event.target.value } : item) }))} /></Field>)}
            <Field label="补充说明" className="sm:col-span-2"><Textarea value={award.description} onChange={(event) => setProfile((p) => ({ ...p, awards: p.awards.map((item, j) => j === i ? { ...item, description: event.target.value } : item) }))} /></Field>
            <Button size="sm" variant="ghost" className="sm:col-span-2 justify-self-end" onClick={() => setProfile((p) => ({ ...p, awards: p.awards.filter((_, j) => j !== i) }))}><Trash2 className="size-4" />删除</Button>
          </div>)}
        </section>

        <section className="space-y-3">
          <p className="text-sm font-medium">其他常问字段{activeVariant ? `（${activeVariant.name}）` : ""}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {EXTRA_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} className={"multiline" in f ? "sm:col-span-3" : undefined}>
                {"multiline" in f ? (
                  <Textarea
                    rows={3}
                    value={view.extras[f.key] ?? ""}
                    onChange={(ev) => setView((v) => ({ ...v, extras: { ...v.extras, [f.key]: ev.target.value } }))}
                    placeholder={f.hint}
                  />
                ) : (
                  <Input
                    value={view.extras[f.key] ?? ""}
                    onChange={(ev) => setView((v) => ({ ...v, extras: { ...v.extras, [f.key]: ev.target.value } }))}
                    placeholder={f.hint}
                  />
                )}
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
