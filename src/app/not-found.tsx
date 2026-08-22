import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <p className="text-3xl font-semibold">404</p>
        <p className="text-sm text-muted-foreground">
          没找到这个页面，可能是链接不对，或者内容已经被删掉了。
        </p>
        <Link
          href="/dashboard"
          className="inline-block text-sm text-primary underline underline-offset-4"
        >
          回到总览
        </Link>
      </div>
    </div>
  );
}
