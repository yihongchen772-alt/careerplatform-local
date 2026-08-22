# 秋招追踪 · 本地单机版

这是 [careerplatform](https://careerplatform-coral.vercel.app) 的独立分支，专门做成不联网也能用的本地桌面 App，跟线上多用户版本完全分开维护，改一边不影响另一边。

跟线上版本比，换掉的东西：

- 数据库从 Postgres 换成 SQLite，存在你自己电脑的本地文件里
- 没有登录，打开就是你一个人的账号（`src/lib/session.ts` 里固定的本地用户）
- 简历/附件存本地文件夹（`src/lib/local-storage.ts`），不是云存储
- 没有邮件相关功能（找回密码、每日提醒邮件）——本来就没有密码

**AI 功能仍然需要联网**：简历体检、匹配、面试攻略、模拟面试、性格测试的
AI 综合分析，都要调用 Gemini/OpenAI/DeepSeek 之类的接口。第一次用之前
去「账号设置」→「AI 设置」填一个你自己的 API Key——本地版没有共享额度。

## 开发模式

```bash
npm install
npm run electron:dev
```

会启动一个本地 Next.js 服务（端口 3210）并打开一个 Electron 窗口指向它。
第一次启动会自动跑数据库迁移（建表），数据存在系统的 App 数据目录里
（Mac 是 `~/Library/Application Support/秋招追踪/`）。

也可以不走 Electron，纯网页调试：`npm run dev`，用的是项目根目录下
`.env` 里配的 `file:./local.db`。

## 打包成安装包

```bash
npm run electron:build
```

产物在 `dist-electron/` 目录。

## 已知限制 / 没验证的部分

- **跨平台打包没测过**：这次开发和打包都在 Mac 上做的，Windows 版的
  `.exe`（NSIS 安装包）配置写了，但没有 Windows 机器实际跑过，理论上
  应该能打包，但没有第一手验证过安装、运行是否顺畅。
- **首次启动稍慢**：第一次打开要跑数据库迁移，正常几秒内完成；如果卡住
  很久说明迁移失败了，看不到界面的话可以在终端跑 `npm run electron:dev`
  看具体报错。
- **没有自动更新机制**：以后代码改了，得重新打包、重新安装，不会自动推送更新。
