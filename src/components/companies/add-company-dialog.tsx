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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addCompanyDirectoryEntry } from "@/lib/actions/companies";
import { researchCompany } from "@/lib/actions/company-research";
import { companyDirectorySectors } from "@/lib/validation";

export function AddCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [researching, setResearching] = useState(false);
  const [name, setName] = useState("");
  const [careerUrl, setCareerUrl] = useState("");
  const [sector, setSector] = useState<string>("");
  const [industry, setIndustry] = useState("");
  const [note, setNote] = useState("");

  async function handleResearch() {
    if (!name.trim()) {
      toast.error("先填公司名称");
      return;
    }
    setResearching(true);
    try {
      const res = await researchCompany(name);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.data;
      if (r.careerUrl) setCareerUrl(r.careerUrl);
      if (r.industry) setIndustry(r.industry);
      if (r.sector && (companyDirectorySectors as readonly string[]).includes(r.sector)) {
        setSector(r.sector);
      }
      setNote(r.note ?? "");
      if (!r.careerUrl) {
        toast.error("AI 没搜到明确的招聘官网链接，请手动填写");
      } else {
        toast.success("已填入 AI 搜索结果，请核实一下链接再保存");
      }
    } finally {
      setResearching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !careerUrl) {
      toast.error("公司名称和招聘链接必填");
      return;
    }
    setLoading(true);
    try {
      await addCompanyDirectoryEntry({
        name,
        careerUrl,
        sector: sector ? (sector as (typeof companyDirectorySectors)[number]) : undefined,
        industry: industry || undefined,
      });
      toast.success("已添加到企业名录");
      setName("");
      setCareerUrl("");
      setSector("");
      setIndustry("");
      setNote("");
      setOpen(false);
    } catch {
      toast.error("添加失败，请检查链接格式");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ 添加公司</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加公司到名录</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          用户添加的条目不带认证标记，请确保链接是该公司官方招聘入口。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">公司名称 *</Label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={researching}
                onClick={handleResearch}
              >
                {researching ? "搜索中..." : "AI 搜索"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              让 AI 联网搜一下这家公司的官方招聘入口和行业信息，仍需你核实链接是否正确
            </p>
          </div>
          {note && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              AI 搜索备注：{note}
            </p>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">招聘官网链接 *</Label>
            <Input
              value={careerUrl}
              onChange={(e) => setCareerUrl(e.target.value)}
              placeholder="https://..."
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">行业分类</Label>
            <Select value={sector} onValueChange={(v) => setSector(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择分类（可选）">
                  {(value: string) => value || "选择分类（可选）"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {companyDirectorySectors.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">细分行业（可选）</Label>
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="例如：新能源汽车"
            />
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
