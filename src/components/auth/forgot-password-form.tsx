"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requestPasswordReset } from "@/lib/actions/account";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await requestPasswordReset({ email });
      setSent(true);
    } catch {
      toast.error("发送失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>邮件已发送</CardTitle>
          <CardDescription>
            如果 {email} 是已注册邮箱，重置链接已经发过去了，去邮箱看看（含垃圾邮件夹）。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>忘记密码</CardTitle>
        <CardDescription>输入注册邮箱，我们发一个重置链接给你</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "发送中..." : "发送重置链接"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
