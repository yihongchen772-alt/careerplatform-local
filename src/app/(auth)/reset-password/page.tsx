import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <p className="text-center text-sm text-muted-foreground">无效的重置链接</p>;
  }

  return <ResetPasswordForm token={token} />;
}
