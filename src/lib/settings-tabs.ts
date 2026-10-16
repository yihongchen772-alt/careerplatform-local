// The settings page's groups, and which group each old #anchor lives in.

export type SettingsTab = "profile" | "autofill" | "memory" | "ai" | "mail" | "appearance" | "data";

export const SETTINGS_TABS: { id: SettingsTab; label: string; description: string }[] = [
  { id: "profile", label: "个人资料", description: "姓名、联系方式、学校和求职方向。小欧和 AI 功能会按这里的方向和城市给建议。" },
  { id: "autofill", label: "网申资料", description: "一键填写用的资料，以及网申里新写的、等你确认的内容。" },
  { id: "memory", label: "经历与问答", description: "确认过的经历版本和问答，一键填写会从这里选；还有浏览器插件。" },
  { id: "ai", label: "AI", description: "选择正在使用的模型、管理各家 API Key 和网络代理。" },
  { id: "mail", label: "邮件与提醒", description: "自动读取求职邮件、后台提醒和每日提醒邮件。" },
  { id: "appearance", label: "外观", description: "界面风格、配色和深浅色。选择后立即生效。" },
  { id: "data", label: "数据与更新", description: "备份、恢复和软件更新。所有数据只保存在这台电脑上。" },
];

/** Card anchors linked from elsewhere in the app, by the group they are in. */
export const SETTINGS_ANCHORS: Record<string, SettingsTab> = {
  "pending-application-changes": "autofill",
  "experience-memory": "memory",
  "answer-memory": "memory",
  "mail-accounts": "mail",
  "auto-progress": "mail",
};

/** `/settings?tab=…#anchor` for a card. */
export function settingsHref(anchor: keyof typeof SETTINGS_ANCHORS | SettingsTab): string {
  const tab = SETTINGS_ANCHORS[anchor];
  return tab ? `/settings?tab=${tab}#${anchor}` : `/settings?tab=${anchor}`;
}
