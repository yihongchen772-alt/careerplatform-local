const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  fs.mkdirSync(".local-run", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const route of ["dashboard", "pool", "leads", "applications", "resumes", "settings", "browser"]) {
      const response = await page.goto(`http://127.0.0.1:3000/${route}`);
      assert.equal(response.status(), 200, route);
      await page.getByRole("button", { name: "打开 AI 助手", exact: true }).waitFor();
    }
    await page.goto("http://127.0.0.1:3000/dashboard");
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByText("求职管家 · 岗位研究 · 投递助手", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "给求职 Agent 发送消息" }).fill("帮我安排本周计划");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("先去账号设置配置一个 AI Key 才能用这个功能", { exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByText("帮我安排本周计划", { exact: true }).waitFor();
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await page.getByText("配置 AI 服务商和 API Key", { exact: true }).waitFor();
    await page.screenshot({ path: ".local-run/agent-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".local-run/agent-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "mobile horizontal overflow");
    assert.deepEqual(errors, []);
    console.log("PASS: 7 routes, Agent UI, missing-key feedback, refresh persistence, clear history, mobile viewport; no page errors.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
