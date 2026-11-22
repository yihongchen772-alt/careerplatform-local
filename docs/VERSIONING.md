# 求职罗盘（JobCompass）版本号规范（v2.0.0 起）

本项目遵循 **语义化版本（Semantic Versioning `MAJOR.MINOR.PATCH`）**，从 `v2.0.0` 起告别 `1.69.x` 的单调递增，明确区分**大迭代、中迭代、小迭代**：

| 版本段 | 定位 | 触发标准 | 示例 |
| --- | --- | --- | --- |
| **`MAJOR.0.0`（大版本 / 里程碑）** | 架构级跃迁或全新代际体验 | 多模块联动的核心形态升级、全新 AI Agent 范式、跨代 UI 设计语言体系重构，或数据结构重大演进 | `v2.0.0`：网申浏览器智能体系 + Apple/Google 双生态 UI + 小欧 2.0（多模态 / CareerOps 闭环 / 实时搜网 / 主动雷达） |
| **`2.MINOR.0`（中迭代 / 功能版本）** | 新增用户可感知的完整能力 | 新专家模式、新招聘平台/国企大类适配、新数据分析看板、新自动化工作流等（向后兼容） | `v2.1.0`、`v2.2.0` |
| **`2.MINOR.PATCH`（小迭代 / 修复与打磨）** | 稳定性、性能与体验微调 | Bug 修复、单个网站选择器修复、提示词微调、CSS/主题细节打磨、依赖安全更新 | `v2.0.1`、`v2.0.2` |

## 发布与自动更新约定
- **Git Tag**：统一为 `vMAJOR.MINOR.PATCH`（如 `v2.0.0`），与 `package.json` 的 `version` 字段保持严格一致。
- **兼容性**：桌面端内置自动更新器（macOS DMG 与 Windows NSIS）均按三段纯数字 SemVer 比较，`2.0.0` 可从任意 `1.x.y` 版本平滑检测并升级，本地 SQLite 数据库零迁移无损兼容。
- **发布门槛**：每次正式发布前必须通过全量 `npm run lint`、`npx tsc --noEmit`、`npm run test:agent`、`npm run test:desktop`、`tests/productivity.test.cjs`、`tests/packaging.test.cjs` 及双端（macOS arm64 + Windows x64）GitHub Actions 打包烟雾测试。
