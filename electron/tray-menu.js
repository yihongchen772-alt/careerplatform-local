// The tray's 接下来 section, built from /api/upcoming. Kept apart from main.js
// so it can be tested without Electron.

const LABEL_MAX = 40;

function shorten(text) {
  const value = String(text || "");
  return value.length > LABEL_MAX ? `${value.slice(0, LABEL_MAX - 1)}…` : value;
}

/**
 * Up to four upcoming 面试 / 笔试, each with what can be done from the tray:
 * join the meeting, copy its number, open the 投递.
 */
function upcomingMenuItems(items, { openMeeting, copyText, openApplication, openBrief, openList }) {
  const list = Array.isArray(items) ? items.filter((item) => item && item.source !== "mail") : [];
  if (list.length === 0) return [{ label: "接下来 7 天没有面试或笔试", enabled: false }];
  const out = [{ label: "接下来", enabled: false }];
  for (const item of list.slice(0, 4)) {
    const submenu = [];
    if (item.meetingUrl) submenu.push({ label: "进入会议", click: () => openMeeting(item.meetingUrl) });
    if (item.meetingNumber) submenu.push({ label: `复制会议号 ${item.meetingNumber}`, click: () => copyText(item.meetingNumber) });
    else if (item.meetingInfo) submenu.push({ label: "复制会议信息 / 地点", click: () => copyText(item.meetingInfo) });
    if (item.applicationId && item.kind === "interview" && openBrief) submenu.push({ label: "面试速览", click: () => openBrief(item.applicationId) });
    if (item.applicationId) submenu.push({ label: "打开投递", click: () => openApplication(item.applicationId) });
    const label = shorten(`${item.label}${item.relative ? `（${item.relative}）` : ""}`);
    out.push(submenu.length ? { label, submenu } : { label, click: openList });
  }
  if (list.length > 4) out.push({ label: `还有 ${list.length - 4} 项…`, click: openList });
  return out;
}

/** 「求职罗盘 · 今天 14:00 宝洁 · 一面（还有 2 小时）」 when something is today. */
function trayTooltip(payload) {
  const first = payload && Array.isArray(payload.items) ? payload.items.find((item) => item.source !== "mail") : null;
  if (!first || !payload.today) return "求职罗盘";
  return shorten(`求职罗盘 · ${first.label}${first.relative ? `（${first.relative}）` : ""}`);
}

module.exports = { upcomingMenuItems, trayTooltip };
