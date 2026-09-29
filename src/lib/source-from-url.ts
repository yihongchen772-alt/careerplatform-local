// Best-effort 渠道 from the page's host, so a saved position or application
// already says where it came from; anything unrecognised is treated as the
// company's own careers site.
export function sourceFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes("zhipin.com")) return "BOSS直聘";
    if (host.includes("nowcoder.com")) return "牛客";
    if (host.includes("liepin.com")) return "猎聘";
    if (host.includes("lagou.com")) return "拉勾";
    if (host.includes("zhaopin.com")) return "智联";
    if (host.includes("51job.com")) return "前程无忧";
    if (host.includes("shixiseng.com")) return "实习僧";
    return "官网";
  } catch {
    return "官网";
  }
}
