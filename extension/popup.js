const $ = (id) => document.getElementById(id);
let tab = null;
let siteInfo = null;
let statusInfo = null;

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, tabId: tab && tab.id, ...payload }).then((res) => {
    if (!res) throw new Error("插件后台没有响应，稍后再试");
    if (!res.ok) {
      const error = new Error(res.error);
      error.code = res.code;
      throw error;
    }
    return res.data;
  });
}

function show(section) {
  for (const id of ["pair", "offline", "main"]) $(id).hidden = id !== section;
}

function message(text, kind = "") {
  const el = $("message");
  el.hidden = !text;
  el.textContent = text || "";
  el.className = `message ${kind}`;
}

function setConn(text, kind) {
  const el = $("conn");
  el.textContent = text;
  el.className = `pill ${kind || ""}`;
}

function option(value, label) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

async function renderSite() {
  const box = $("site");
  box.textContent = "";
  if (!tab || !/^https?:/.test(tab.url || "")) return;
  try {
    siteInfo = await send("site");
  } catch {
    return;
  }
  const { match, candidateCenter, portalSet, page } = siteInfo;
  if (page && page.success) {
    const div = document.createElement("div");
    div.className = "banner success";
    div.textContent = `页面显示“${page.success.evidence}”。确认提交成功后，点「记为已投递」存进投递记录。`;
    box.appendChild(div);
  }
  if (candidateCenter && !portalSet) {
    const div = document.createElement("div");
    div.className = "banner portal";
    div.textContent = match ? `这像是「${match.companyName}」的“我的投递”页。设为进度页后，求职罗盘会定期读取它，自动推进投递阶段。` : "这像是“我的投递”页，但没对应到你已投的公司：先在 App 里记一条这家公司的投递。";
    if (match) {
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = `设为「${match.companyName}」的进度页`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await send("portal", { companyId: match.companyId, url: tab.url });
          div.textContent = `已设为「${match.companyName}」的进度页，App 运行时会自动同步阶段。`;
        } catch (err) {
          btn.disabled = false;
          message(err.message, "error");
        }
      });
      div.appendChild(btn);
    }
    box.appendChild(div);
  } else if (match && match.applications.length) {
    const div = document.createElement("div");
    div.className = "banner warn";
    const list = match.applications.slice(0, 3).map((a) => `${a.title}（${a.stage}）`).join("、");
    div.textContent = `你已投过「${match.companyName}」：${list}${match.applications.length > 3 ? ` 等 ${match.applications.length} 个` : ""}。确认不是重复投递再提交。`;
    box.appendChild(div);
  }
}

async function load() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    statusInfo = await send("status");
  } catch (err) {
    if (err.code === "unpaired") {
      setConn("未配对", "bad");
      show("pair");
      if (!/还没配对/.test(err.message)) {
        $("pair-error").hidden = false;
        $("pair-error").textContent = err.message;
      }
    } else {
      setConn("未连接", "bad");
      $("offline-text").textContent = err.message;
      show("offline");
    }
    return;
  }
  setConn(`已连接 · v${statusInfo.appVersion}`, "ok");
  show("main");
  const prefs = await chrome.storage.local.get(["resumeVersionId", "variantId", "expandBlocks"]);
  const resume = $("resume");
  resume.textContent = "";
  resume.appendChild(option("", "不用简历（只填基础资料）"));
  for (const r of statusInfo.resumes) resume.appendChild(option(r.id, r.name + (r.isDefault ? "（默认）" : "")));
  resume.value = prefs.resumeVersionId ?? (statusInfo.resumes.find((r) => r.isDefault) || statusInfo.resumes[0] || { id: "" }).id;
  const variant = $("variant");
  variant.textContent = "";
  $("variant-row").hidden = statusInfo.variants.length === 0;
  variant.appendChild(option("", "跟随简历"));
  variant.appendChild(option("default", "默认资料"));
  for (const v of statusInfo.variants) variant.appendChild(option(v.id, v.name));
  variant.value = prefs.variantId || "";
  $("expand").checked = !!prefs.expandBlocks;
  const last = await send("lastStatus").catch(() => null);
  if (last && Date.now() - last.at < 10 * 60 * 1000) message(last.message, last.phase === "error" ? "error" : "");
  renderSite();
}

$("pair-btn").addEventListener("click", async () => {
  const token = $("pair-token").value.trim();
  if (!token) return;
  $("pair-btn").disabled = true;
  try {
    await send("pair", { token });
    $("pair-error").hidden = true;
    await load();
  } catch (err) {
    $("pair-error").hidden = false;
    $("pair-error").textContent = err.message;
  } finally {
    $("pair-btn").disabled = false;
  }
});

$("retry").addEventListener("click", load);
$("resume").addEventListener("change", (e) => chrome.storage.local.set({ resumeVersionId: e.target.value }));
$("variant").addEventListener("change", (e) => chrome.storage.local.set({ variantId: e.target.value }));
$("expand").addEventListener("change", (e) => chrome.storage.local.set({ expandBlocks: e.target.checked }));

$("fill").addEventListener("click", async () => {
  // Cross-origin iframes (北森/Moka forms are often embedded) need host
  // access beyond the clicked tab; asked once, and the fill still runs on the
  // top frame if the applicant declines.
  await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false);
  $("fill").disabled = true;
  message("正在读取页面…");
  try {
    await send("fill", { resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, expandBlocks: $("expand").checked });
  } catch (err) {
    message(err.message, "error");
    $("fill").disabled = false;
  }
});

$("save").addEventListener("click", async () => {
  try {
    const { saved } = await send("save");
    message(saved > 0 ? `已记住 ${saved} 项你手填的内容，下次网申会优先复用` : "这页没有可记住的新内容");
  } catch (err) {
    message(err.message, "error");
  }
});

$("capture").addEventListener("click", async () => {
  $("capture").disabled = true;
  message("AI 正在解析这页岗位…");
  try {
    const result = await send("capture");
    message(result.duplicate ? `候选池里已有「${result.companyName} · ${result.title}」` : `已加入候选岗位池：${result.companyName} · ${result.title}`);
  } catch (err) {
    message(err.message, "error");
  } finally {
    $("capture").disabled = false;
  }
});

$("record-toggle").addEventListener("click", () => {
  const form = $("record");
  form.hidden = !form.hidden;
  if (!form.hidden) {
    $("record-company").value = (siteInfo && siteInfo.match && siteInfo.match.companyName) || "";
    $("record-title").value = ((tab && tab.title) || "").slice(0, 80);
    ($("record-company").value ? $("record-title") : $("record-company")).focus();
  }
});

$("record").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await send("record", { companyName: $("record-company").value, title: $("record-title").value, applyUrl: tab.url, resumeVersionId: $("resume").value || undefined });
    $("record").hidden = true;
    message("已记入投递记录。之后打开这家公司的“我的投递”页，可以一键设为进度页。");
  } catch (err) {
    message(err.message, "error");
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "status" || !tab || msg.tabId !== tab.id) return;
  message(msg.status.message, msg.status.phase === "error" ? "error" : "");
  if (msg.status.phase === "done" || msg.status.phase === "error") $("fill").disabled = false;
});

load();
