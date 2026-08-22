"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendReminderDigestNow } from "@/lib/actions/reminder-digest";

export function SendDigestButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await sendReminderDigestNow();
      if (res.ok) {
        toast.success(
          res.data.count > 0 ? `已发送，${res.data.count} 件事` : "已发送"
        );
      } else {
        toast.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={loading}>
      <Mail />
      {loading ? "发送中..." : "发送提醒邮件"}
    </Button>
  );
}
