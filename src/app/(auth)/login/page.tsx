import { googleEnabled } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <LoginForm googleEnabled={googleEnabled} />;
}
