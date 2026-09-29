"use client";

import { useState } from "react";

/**
 * Local smoke-test page for the Electron application browser. Open
 * http://localhost:<port>/browser-demo inside 网申浏览器; it exercises basic
 * fields, a resume upload, a second wizard step and success detection without
 * sending any personal data to a real employer.
 */
export default function BrowserDemoPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  if (step === 3) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-10">
        <h1 className="text-2xl font-semibold">投递成功</h1>
        <p>感谢您的申请，我们已经收到你的简历。</p>
        <button className="rounded-md border px-4 py-2" onClick={() => setStep(1)}>重新测试</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-10">
      <div>
        <h1 className="text-2xl font-semibold">网申自动填充测试页</h1>
        <p className="text-sm text-muted-foreground">第 {step}/2 页。本页只在本机运行，不会提交到外部网站。</p>
      </div>
      {step === 1 ? (
        <section className="space-y-4">
          <label className="block space-y-1"><span>姓名</span><input name="name" className="w-full rounded-md border p-2" /></label>
          <label className="block space-y-1"><span>联系邮箱</span><input type="email" name="email" className="w-full rounded-md border p-2" /></label>
          <label className="block space-y-1"><span>手机号码</span><input type="tel" name="phone" className="w-full rounded-md border p-2" /></label>
          <label className="block space-y-1"><span>上传简历</span><input type="file" name="resume" accept=".pdf,.doc,.docx" className="block w-full rounded-md border p-2" /></label>
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => setStep(2)}>下一步</button>
        </section>
      ) : (
        <section className="space-y-4">
          <label className="block space-y-1"><span>为什么申请这个岗位？</span><textarea name="motivation" className="min-h-32 w-full rounded-md border p-2" /></label>
          <label className="block space-y-1"><span>最高学历</span><select name="degree" className="w-full rounded-md border p-2"><option value="">请选择</option><option>本科</option><option>硕士</option><option>博士</option></select></label>
          <div className="space-y-4">
            <h2 className="font-medium">教育经历</h2>
            {[1, 2].map((n) => (
              <div key={n} className="space-y-3 rounded-md border p-3">
                <h3 className="text-sm text-muted-foreground">教育经历 {n}</h3>
                <label className="block space-y-1"><span>学校名称</span><input name={`edu${n}_school`} className="w-full rounded-md border p-2" /></label>
                <label className="block space-y-1"><span>专业</span><input name={`edu${n}_major`} className="w-full rounded-md border p-2" /></label>
                <label className="block space-y-1"><span>学历</span><select name={`edu${n}_degree`} className="w-full rounded-md border p-2"><option value="">请选择</option><option>本科</option><option>硕士研究生</option><option>博士研究生</option></select></label>
              </div>
            ))}
          </div>
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => setStep(3)}>模拟提交成功</button>
        </section>
      )}
    </main>
  );
}
