import Link from "next/link";
import { Globe, PenLine, Sparkles, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ImportApplicationsDialog } from "@/components/applications/import-applications-dialog";
import { Button } from "@/components/ui/button";

/**
 * What an empty 总览 shows first: three ways to get the first 投递 in, before
 * anything else. Gone as soon as there is one.
 */
export function FirstRunCard() {
  return (
    <Card className="surface-card rounded-xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-base font-semibold">欢迎，先把第一条投递放进来</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">选最顺手的一种，之后进度、日历、提醒都会跟着这些投递走。</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-background/35 p-4">
          <div>
            <p className="text-sm font-medium">已经有投递表格</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Excel 或 CSV 直接导入，状态会自动对应到进度，导错了可以一键撤销。</p>
          </div>
          <ImportApplicationsDialog trigger={<Button size="sm" className="w-fit"><Upload />导入表格</Button>} />
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-background/35 p-4">
          <div>
            <p className="text-sm font-medium">现在就去网申</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">在软件自带的浏览器里打开招聘官网，一键填表，提交后点「记为已投递」就自动记下。</p>
          </div>
          <Link href="/browser" className="inline-flex w-fit items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"><Globe className="size-4" />打开网申浏览器</Link>
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-background/35 p-4">
          <div>
            <p className="text-sm font-medium">手动记一条</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">投了就记：公司、岗位、投递日期，三项就够。</p>
          </div>
          <Link href="/applications" className="inline-flex w-fit items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"><PenLine className="size-4" />去投递记录</Link>
        </div>
      </div>
    </Card>
  );
}
