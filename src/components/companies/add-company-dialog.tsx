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
import { companyDirectorySectors } from "@/lib/validation";

export function AddCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [careerUrl, setCareerUrl] = useState("");
  const [sector, setSector] = useState<string>("");
  const [industry, setIndustry] = useState("");

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
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
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
