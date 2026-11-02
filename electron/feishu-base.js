// Reads a 飞书多维表格 (Base) shared by link — the 校招信息表 people buy and
// share — without a 飞书 account: the page loads in a hidden window, which
// gets the share's own cookies, and its own record API is then called from
// inside that page, a page of rows at a time. Only feishu.cn / larksuite.com
// base links are accepted; nothing is written to the sheet.

const SHEET_PARTITION = "cp-sheets";
const LOAD_TIMEOUT_MS = 45000;
const MAX_ROWS = 50000;

function isBaseLink(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname) && /^\/(?:share\/)?base\/[A-Za-z0-9]+/.test(url.pathname);
  } catch {
    return false;
  }
}

// Runs inside the sheet's page: every row as { id, cells: { 列名: text } }.
async function readAllRows(clientvarsUrl, maxRows) {
  const inflate = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  };
  const getJson = async (url) => {
    const res = await fetch(url, { credentials: "include" });
    const body = await res.json();
    if (body.code !== 0) throw new Error(`飞书返回错误 ${body.code}：${body.msg || ""}`);
    return body.data;
  };
  const vars = await getJson(clientvarsUrl);
  const table = await inflate(vars.table);
  const fields = table.fieldMap || {};
  const options = {};
  for (const [id, field] of Object.entries(fields)) options[id] = Object.fromEntries(((field.property || {}).options || []).map((o) => [o.id, o.name]));
  const day = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const text = (id, value) => {
    const type = fields[id].type;
    if (value == null) return "";
    if (type === 3 || type === 4) return (Array.isArray(value) ? value : [value]).map((v) => options[id][v] || "").filter(Boolean).join("、");
    if (type === 5) return typeof value === "number" ? day(value) : "";
    if (type === 7) return value ? "是" : "";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((seg) => (seg && typeof seg === "object" ? (seg.type === "url" || type === 15 ? seg.link || seg.text : seg.text) || "" : "")).join("").trim();
    return "";
  };
  const records = { ...(table.recordMap || {}) };
  const total = Math.min(table.recordCount || 0, maxRows);
  if (Object.keys(records).length < total) {
    const base = new URL(clientvarsUrl);
    // The first load asks for the default table with an empty tableID; the answer names it.
    const tableId = base.searchParams.get("tableID") || (table.meta || {}).id;
    const viewId = base.searchParams.get("viewID") || vars.currentView || "";
    const pageUrl = new URL(base.pathname.replace(/clientvars$/, "records"), base.origin);
    for (let offset = 0; offset < total; offset += 3000) {
      for (const [key, value] of Object.entries({ tableId, viewId, tableRev: String((table.meta || {}).rev ?? ""), depRev: "{}", viewLazyLoad: "true", offset: String(offset), limit: "3000", tableID: tableId, viewID: viewId, removeFmlExtra: "true" })) pageUrl.searchParams.set(key, value);
      const page = await inflate((await getJson(pageUrl)).records);
      const got = Object.keys(page.recordMap || {}).length;
      Object.assign(records, page.recordMap);
      if (!got) break;
    }
  }
  const names = Object.fromEntries(Object.entries(fields).map(([id, field]) => [id, field.name]));
  const rows = Object.entries(records).slice(0, maxRows).map(([id, row]) => {
    const cells = {};
    for (const [fieldId, cell] of Object.entries(row || {})) {
      if (!names[fieldId]) continue;
      const value = text(fieldId, cell && cell.value);
      if (value) cells[names[fieldId]] = value;
    }
    return { id, cells };
  });
  return { name: document.title.replace(/\s*-\s*飞书.*$/, "").trim(), columns: Object.values(names), rows };
}

async function readFeishuBase(url) {
  if (!isBaseLink(url)) throw new Error("只支持飞书多维表格的分享链接（https://…feishu.cn/base/…）");
  const { BrowserWindow, session } = require("electron");
  const ses = session.fromPartition(SHEET_PARTITION);
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, images: false } });
  let clientvarsUrl = null;
  const seen = new Promise((resolve) => {
    ses.webRequest.onBeforeRequest({ urls: ["https://*/space/api/v1/bitable/*"] }, (details, callback) => {
      if (details.webContentsId === win.webContents.id && /\/clientvars\?/.test(details.url) && !clientvarsUrl) {
        clientvarsUrl = details.url;
        resolve();
      }
      callback({});
    });
  });
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("飞书表格打开超时：检查链接是否完整、网络能否打开飞书（别挂 VPN）")), LOAD_TIMEOUT_MS));
    await Promise.race([win.loadURL(url).then(() => seen), timeout]);
    return await win.webContents.executeJavaScript(`(${readAllRows.toString()})(${JSON.stringify(clientvarsUrl)}, ${MAX_ROWS})`);
  } finally {
    ses.webRequest.onBeforeRequest(null);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { readFeishuBase, isBaseLink };
