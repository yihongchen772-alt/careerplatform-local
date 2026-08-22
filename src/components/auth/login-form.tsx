"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
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

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      toast.error("邮箱或密码不正确");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>登录后管理你的投递记录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
          <p className="text-center text-sm">
            <a
              href="/forgot-password"
              className="text-muted-foreground underline underline-offset-4"
            >
              忘记密码？
            </a>
          </p>
        </form>

        {googleEnabled && (
          <>
            <div className="relative text-center text-xs text-muted-foreground">
              <span className="bg-card px-2 relative z-10">或</span>
              <div className="absolute inset-x-0 top-1/2 border-t" />
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            >
              使用 Google 登录
            </Button>
          </>
        )}

        <p className="text-center text-sm text-muted-foreground">
          还没有账号？{" "}
          <a href="/register" className="underline underline-offset-4">
            注册
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
