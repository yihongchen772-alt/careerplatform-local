import { BookOpen, Brain, Building2, Crosshair, FolderOpen, Library, NotebookPen, Scale, Users, type LucideIcon } from "lucide-react";

export type ToolGroup = "面试备考" | "企查与决策" | "材料与记录";

/** On 工具箱 (/tools): grouped by job-hunt lifecycle stage, one click away. */
export const TOOL_LINKS: { href: string; label: string; icon: LucideIcon; description: string; group: ToolGroup }[] = [
  { href: "/resume-drill", label: "简历深挖", icon: Crosshair, description: "按简历逐条追问，提前准备面试官会挖的点", group: "面试备考" },
  { href: "/interviews", label: "面经库", icon: BookOpen, description: "自己的面试记录和复盘，按公司、轮次查", group: "面试备考" },
  { href: "/question-banks", label: "题库", icon: Library, description: "笔试、面试题，刷题和错题", group: "面试备考" },
  { href: "/companies", label: "企业名录", icon: Building2, description: "公司资料、官网入口和岗位雷达", group: "企查与决策" },
  { href: "/compare", label: "Offer 对比", icon: Scale, description: "多个 Offer 的薪资、城市、发展放在一起比", group: "企查与决策" },
  { href: "/library", label: "资料库", icon: FolderOpen, description: "证书、成绩单、作品等网申常用文件", group: "材料与记录" },
  { href: "/contacts", label: "联系人", icon: Users, description: "HR、内推人、学长学姐，和跟进提醒", group: "材料与记录" },
  { href: "/journey", label: "心路历程", icon: NotebookPen, description: "随手记下求职路上的心情和收获", group: "材料与记录" },
  { href: "/personality", label: "性格测试", icon: Brain, description: "性格测评练习和结果", group: "材料与记录" },
];

