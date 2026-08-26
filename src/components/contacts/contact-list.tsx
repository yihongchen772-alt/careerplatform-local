"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  ContactFormDialog,
  type ContactInitial,
} from "@/components/contacts/contact-form-dialog";
import { markContacted, deleteContact } from "@/lib/actions/contacts";
import { daysUntil } from "@/lib/reminders";

type LinkOption = { id: string; label: string };

export type ContactRow = ContactInitial & { lastContactedAt: string | null };

function followUpNote(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const daysLeft = daysUntil(new Date(iso));
  if (daysLeft < 0) return { text: `已过期 ${-daysLeft} 天该跟进了`, urgent: true };
  if (daysLeft === 0) return { text: "今天该跟进", urgent: true };
  if (daysLeft <= 3) return { text: `还有 ${daysLeft} 天该跟进`, urgent: true };
  return { text: `${daysLeft} 天后跟进`, urgent: false };
}

export function ContactList({
  contacts,
  positions,
  applications,
}: {
  contacts: ContactRow[];
  positions: LinkOption[];
  applications: LinkOption[];
}) {
  const pending = [...contacts].sort((a, b) => {
    if (!a.nextFollowUpAt && !b.nextFollowUpAt) return 0;
    if (!a.nextFollowUpAt) return 1;
    if (!b.nextFollowUpAt) return -1;
    return a.nextFollowUpAt.localeCompare(b.nextFollowUpAt);
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>联系人</CardTitle>
        <ContactFormDialog
          positions={positions}
          applications={applications}
          trigger={
            <Button size="sm" variant="outline">
              <Plus />
              添加
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {contacts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Users className="size-8 text-muted-foreground/50" />
            <p className="text-sm">
              还没有联系人——HR、内推人、面试官，投腾讯留的 QQ 邮箱对应哪个 HR，
              都可以记在这里，到日子会提醒你跟进
            </p>
          </div>
        ) : (
          pending.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              positions={positions}
              applications={applications}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ContactRow({
  contact,
  positions,
  applications,
}: {
  contact: ContactRow;
  positions: LinkOption[];
  applications: LinkOption[];
}) {
  const [busy, setBusy] = useState(false);
  const linked =
    positions.find((p) => p.id === contact.positionId) ??
    applications.find((a) => a.id === contact.applicationId);
  const followUp = followUpNote(contact.nextFollowUpAt);

  async function handleMarkContacted() {
    setBusy(true);
    try {
      await markContacted(contact.id);
      toast.success("已标记为联系过");
    } catch {
      toast.error("操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteContact(contact.id);
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1.5 font-medium">
          {contact.name}
          {contact.role && (
            <span className="text-xs font-normal text-muted-foreground">
              · {contact.role}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {[contact.companyName, contact.contactInfo, linked?.label]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {followUp && (
          <p
            className={
              followUp.urgent
                ? "text-xs font-medium text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {followUp.text}
          </p>
        )}
        {!followUp && contact.lastContactedAt && (
          <p className="text-xs text-muted-foreground">
            上次联系：{new Date(contact.lastContactedAt).toLocaleDateString()}
          </p>
        )}
        {contact.note && <p className="mt-1 text-xs">{contact.note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {contact.nextFollowUpAt && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={handleMarkContacted}>
            <UserCheck className="size-3.5" />
            已联系
          </Button>
        )}
        <ContactFormDialog
          positions={positions}
          applications={applications}
          initial={contact}
          trigger={
            <Button size="sm" variant="ghost">
              编辑
            </Button>
          }
        />
        <ConfirmDeleteButton
          trigger={
            <Button size="sm" variant="ghost">
              删除
            </Button>
          }
          title={`确定删除联系人「${contact.name}」吗？`}
          onConfirm={handleDelete}
        />
      </div>
    </div>
  );
}
