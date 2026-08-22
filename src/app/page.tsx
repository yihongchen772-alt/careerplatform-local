import { redirect } from "next/navigation";

// No login in the local build — there's exactly one user (see
// src/lib/session.ts), so there's nothing to authenticate.
export default function Home() {
  redirect("/dashboard");
}
