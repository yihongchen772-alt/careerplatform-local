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
function trayTooltip(payload, activeProfile) {
  const prefix =
    activeProfile && !activeProfile.isDefault && activeProfile.id && activeProfile.id !== "default"
      ? `求职罗盘 [${activeProfile.displayName || activeProfile.name}]`
      : "求职罗盘";
  const first = payload && Array.isArray(payload.items) ? payload.items.find((item) => item.source !== "mail") : null;
  if (!first || !payload.today) return shorten(prefix);
  return shorten(`${prefix} · ${first.label}${first.relative ? `（${first.relative}）` : ""}`);
}

/**
 * Builds the `👥 切换求职人` submenu items shared by the macOS/Windows
 * application menu bar and the system tray menu.
 */
function profileSwitchMenuItems(profiles, activeProfileId, { onSwitch, onCreateProfile } = {}) {
  const list = Array.isArray(profiles) ? profiles : [];
  const items = list.map((profile) => {
    const active = profile.id === activeProfileId;
    const baseLabel = String(profile.displayName || profile.name || "未命名档案");
    return {
      label: shorten(baseLabel),
      type: "radio",
      checked: active,
      click: () => {
        if (!active && typeof onSwitch === "function") onSwitch(profile.id);
      },
    };
  });
  if (typeof onCreateProfile === "function") {
    if (items.length > 0) items.push({ type: "separator" });
    items.push({
      label: "+ 新增求职人（如：对象）…",
      click: () => onCreateProfile(),
    });
  }
  return items;
}

module.exports = { upcomingMenuItems, trayTooltip, profileSwitchMenuItems };
