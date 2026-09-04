import { requireUser } from "@/lib/session";
import { EmbeddedBrowser } from "@/components/browser/embedded-browser";

export default async function BrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  await requireUser();
  const { url } = await searchParams;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 md:h-[calc(100vh-5rem)]">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">网申浏览器</h1>
        <p className="text-sm text-muted-foreground">
          在这里打开网申页面，AI 一键填充能帮你把基础信息和开放性问答题填进去——填完提交前务必自己检查一遍
        </p>
      </div>
      <EmbeddedBrowser initialUrl={url} />
    </div>
  );
}
