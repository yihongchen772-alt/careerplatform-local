"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh">
      <body className="flex min-h-screen items-center justify-center bg-white p-6 text-neutral-900">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold">页面出了点问题</h1>
          <p className="text-sm text-neutral-500">
            刚才的操作没能完成。可以重试一次，如果一直这样请稍后再来。
          </p>
          <button
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
