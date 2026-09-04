"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createContact, updateContact } from "@/lib/actions/contacts";

type LinkOption = { id: string; label: string };

export type ContactInitial = {
  id: string;
  name: string;
  role: string | null;
  companyName: string | null;
  contactInfo: string | null;
  note: string | null;
  nextFollowUpAt: string | null;
  positionId: string | null;
  applicationId: string | null;
};

const NONE = "__none__";

export function ContactFormDialog({
  positions,
  applications,
  initial,
  trigger,
}: {
  positions: LinkOption[];
  applications: LinkOption[];
  initial?: ContactInitial;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [contactInfo, setContactInfo] = useState(initial?.contactInfo ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [nextFollowUpAt, setNextFollowUpAt] = useState(
    initial?.nextFollowUpAt?.slice(0, 10) ?? ""
  );
  // "关联到" is one dropdown covering both lists — same pattern as personal
  // tasks: a contact is about one job search item or it isn't.
  const [linkValue, setLinkValue] = useState(
    initial?.positionId
      ? `position:${initial.positionId}`
      : initial?.applicationId
        ? `application:${initial.applicationId}`
        : NONE
  );

  function reset() {
    setName(initial?.name ?? "");
    setRole(initial?.role ?? "");
    setCompanyName(initial?.companyName ?? "");
    setContactInfo(initial?.contactInfo ?? "");
    setNote(initial?.note ?? "");
    setNextFollowUpAt(initial?.nextFollowUpAt?.slice(0, 10) ?? "");
    setLinkValue(
      initial?.positionId
        ? `position:${initial.positionId}`
        : initial?.applicationId
          ? `application:${initial.applicationId}`
          : NONE
    );
  }

  function handleOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      toast.error("姓名必填");
      return;
    }
    const [kind, linkId] = linkValue === NONE ? [null, null] : linkValue.split(":");
    setLoading(true);
    try {
      const payload = {
        name,
        role: role || undefined,
        companyName: companyName || undefined,
        contactInfo: contactInfo || undefined,
        note: note || undefined,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
        positionId: kind === "position" ? linkId : undefined,
        applicationId: kind === "application" ? linkId : undefined,
      };
      if (initial) {
        await updateContact(initial.id, payload);
        toast.success("已保存");
      } else {
        await createContact(payload);
        toast.success("已添加");
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  const linkLabel =
    linkValue === NONE
      ? "不关联"
      : (positions.find((p) => `position:${p.id}` === linkValue) ??
          applications.find((a) => `application:${a.id}` === linkValue))?.label;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "编辑联系人" : "添加联系人"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">姓名 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">角色</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="HR / 内推人 / 面试官..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">公司（可选）</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">联系方式（可选）</Label>
              <Input
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="微信 / 邮箱 / 电话"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">下次跟进日期（可选）</Label>
            <Input
              type="date"
              value={nextFollowUpAt}
              onChange={(e) => setNextFollowUpAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">关联到（可选）</Label>
            <Select value={linkValue} onValueChange={(v) => v && setLinkValue(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => linkLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>不关联</SelectItem>
                {applications.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>已投递</SelectLabel>
                      {applications.map((a) => (
                        <SelectItem key={a.id} value={`application:${a.id}`}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                {positions.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>候选</SelectLabel>
                      {positions.map((p) => (
                        <SelectItem key={p.id} value={`position:${p.id}`}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">备注</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
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
