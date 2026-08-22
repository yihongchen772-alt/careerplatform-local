# 秋招追踪平台

投递记录管理、面试进展跟踪、候选岗位打分排序的秋招求职工具。

## 技术栈

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma ORM
- NextAuth.js（邮箱密码登录，预留 Google 登录）
- Tailwind CSS + shadcn/ui（基于 Base UI）

## 线上地址

生产环境：https://careerplatform-coral.vercel.app

托管在 Vercel，数据库是 Vercel 市场里的 Neon Postgres 集成（生产库和本地开发库是分开的两个实例）。

代码仓库：https://github.com/yihongchen772-alt/careerplatform （私有仓库）

### 部署 / 更新线上版本

已经连了 GitHub 自动部署——push 到 `main` 分支，Vercel 会自动构建部署，不用再手动跑 `vercel deploy`。

如果改了 `prisma/schema.prisma`，**push 前**记得先对生产库跑一次迁移（迁移不会自动执行）：

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
# DATABASE_URL 需要临时指向生产库（Neon 的 unpooled 连接串，在 Vercel 项目设置 -> Environment Variables 里能看到）
```

如果需要手动触发一次部署（不想等 push），还是可以用：

```bash
npx vercel deploy --prod
```

## 本地开发

### 1. 准备数据库

本机已通过 Homebrew 安装并启动了 PostgreSQL 16，数据库名为 `careerplatform`。

如果 Postgres 没有在跑，手动启动：

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/pg16.log start
```

停止：

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 stop
```

（`brew services start postgresql@16` 在这台机器上状态显示异常，建议直接用 `pg_ctl`。）

### 2. 环境变量

`.env` 已经生成好，可参考 `.env.example`。

**重要**：本地开发只用 `.env`，不要让 `.env.local` 存在（Next.js 加载 `.env.local` 优先级高于 `.env`）。之前踩过坑：Vercel/Neon 集成会自动生成 `.env.local` 并写入生产数据库连接串，导致本地 `npm run dev` 实际连到了线上库。每次装新的 Vercel 集成（Blob、Neon 等）后，检查一下有没有冒出 `.env.local`，有就删掉或改名。

如果要开启 Google 登录，去 Google Cloud Console 创建 OAuth 客户端，把 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 填进 `.env`，登录页会自动出现 Google 登录按钮。

其他环境变量：
- `BLOB_READ_WRITE_TOKEN`：Vercel Blob 存储凭证（简历/面试附件上传用）
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL`：发邮件用（密码重置、每日提醒摘要）。**注意**：免费的 `onboarding@resend.dev` 发件地址只能发给 Resend 账号自己的邮箱，发给其他注册用户会被拒收。要让所有用户都能收到邮件，需要在 Resend 里验证自己的域名。
- `CRON_SECRET`：保护 `/api/cron/reminders` 这个定时任务接口，防止被外部随意调用

### 3. 安装依赖 & 启动

```bash
npm install
npx prisma migrate dev   # 首次运行或改动 schema 后执行
npm run dev
```

访问 http://localhost:3000

### 常用命令

```bash
npx prisma studio        # 图形化查看/编辑数据库
npx prisma migrate dev   # 应用新的 schema 变更
npm run lint
npm run build
```

## 功能范围

- 邮箱密码注册登录（Google 登录预留），忘记密码 / 重置密码（邮件）
- 候选岗位池：打分排序（技术栈35% / 薪资25% / 地点20% / 成长20%），一键"标记已投"生成投递记录
- 投递记录表格：筛选、状态徽章、距上次更新天数高亮
- 投递详情页：状态流转时间线、面试复盘笔记、笔试截图/面经/offer letter 等文件上传（Vercel Blob）
- 简历版本管理，支持真文件上传（PDF/图片）
- 企业名录：知名大厂校招入口（平台核实 + 用户自行添加）
- Offer 对比：横向比较薪资、地点、决策截止日期
- 账号设置：编辑个人资料、修改密码
- Dashboard：漏斗统计、停滞投递提醒、候选岗位截止提醒
- 每日邮件提醒摘要（Vercel Cron，每天北京时间早上 9 点检查一遍，有停滞/即将截止的才发邮件）
- PWA：可在手机上"添加到主屏幕"，全屏体验

所有数据按用户隔离（每张业务表带 `userId`），架构上已支持多用户。

## 考虑之后上线的功能

- 导师/顾问只读共享（ShareGrant）
- 粘贴岗位网址自动解析（需要接大模型 API，涉及费用，等用户确认后再做）
- 上传简历自动匹配岗位（同上，需要大模型 API）
- 看板拖拽视图
- 霍兰德职业兴趣测试/性格测试：MBTI、DISC、OCEAN
