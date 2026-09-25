"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setApplicationPortal } from "@/lib/actions/application-sync";

export function PortalAssignmentCard({ applicationId, currentPortalId, portals }: {
  applicationId: string;
  currentPortalId: string | null;
  portals: { id: string; label: string | null; url: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentPortalId ?? "none");
  const [saving, setSaving] = useState(false);
  if (portals.length === 0) return null;

  async function save() {
    setSaving(true);
    try {
      const result = await setApplicationPortal(applicationId, value === "none" ? null : value);
      if (!result.ok) return void toast.error(result.message);
      toast.success("已更新这条投递的官网进度来源");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return <Card><CardHeader><CardTitle>官网进度来源</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs leading-5 text-muted-foreground">请选择这条投递实际使用的进度页；暂不关联时不会同步官网状态，避免不同入口的记录串线。</p>
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value} onValueChange={(next) => next && setValue(next)}>
        <SelectTrigger className="min-w-52 max-w-full"><SelectValue>{() => value === "none" ? "暂不关联" : (portals.find((portal) => portal.id === value)?.label || portals.find((portal) => portal.id === value)?.url || "选择进度页")}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">暂不关联</SelectItem>
          {portals.map((portal) => <SelectItem key={portal.id} value={portal.id}>{portal.label || portal.url}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" disabled={saving || value === (currentPortalId ?? "none")} onClick={save}>{saving ? "保存中…" : "保存关联"}</Button>
    </div>
  </CardContent></Card>;
}
