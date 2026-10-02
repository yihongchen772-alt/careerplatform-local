const $ = (id) => document.getElementById(id);
let tab = null;
let siteInfo = null;
let statusInfo = null;
let filling = false;

function fillModules() {
  return Array.from(document.querySelectorAll("[data-module]:checked"), (input) => input.dataset.module);
}

function updateScope() {
  const selected = fillModules();
  const total = document.querySelectorAll("[data-module]").length;
  const single = selected.length === 1 ? document.querySelector(`[data-module="${selected[0]}"]`).closest("label").textContent.trim() : null;
  $("scope-summary").textContent = `填写范围：${selected.length === total ? "全部模块" : single || `${selected.length} 个模块`}`;
  $("fill").textContent = selected.length === total ? "一键填写这一页" : "填写所选模块";
  $("fill").disabled = filling || !selected.length;
  $("cancel").hidden = !filling;
}

function saveScope() {
  updateScope();
  return chrome.storage.local.set({ fillModules: fillModules() });
}

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

let resultDetails = [];
function renderDetails(details = resultDetails) {
  resultDetails = details;
  $("result-details").hidden = !details.length;
  $("result-list").textContent = "";
  const visible = $("only-manual").checked ? details.filter((d) => d.source === "manual") : details;
  for (const detail of visible) {
    const li = document.createElement("li"); li.textContent = `${detail.label} · ${detail.state}`; if (detail.id) { li.style.cursor = "pointer"; li.addEventListener("click", () => send("focus", { id: detail.id })); } $("result-list").appendChild(li);
  }
  if (!visible.length && details.length) { const li = document.createElement("li"); li.textContent = "没有需要手填或写入失败的字段"; $("result-list").appendChild(li); }
}
$("only-manual").addEventListener("change", () => renderDetails());

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
  const prefs = await chrome.storage.local.get(["resumeVersionId", "variantId", "expandBlocks", "fillModules"]);
  if (Array.isArray(prefs.fillModules)) {
    for (const input of document.querySelectorAll("[data-module]")) input.checked = prefs.fillModules.includes(input.dataset.module);
  }
  updateScope();
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
  if (last && Date.now() - last.at < 10 * 60 * 1000) {
    renderDetails(last.details || []);
    renderPlan(last.plan);
    message(last.message, last.phase === "error" ? "error" : "");
    filling = last.phase !== "done" && last.phase !== "error" && last.phase !== "preview";
    updateScope();
  }
  await loadAssistant();
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
for (const input of document.querySelectorAll("[data-module]")) input.addEventListener("change", saveScope);
$("scope-all").addEventListener("click", () => {
  for (const input of document.querySelectorAll("[data-module]")) input.checked = true;
  void saveScope();
});
$("scope-none").addEventListener("click", () => {
  for (const input of document.querySelectorAll("[data-module]")) input.checked = false;
  void saveScope();
});

$("fill").addEventListener("click", async () => {
  const modules = fillModules();
  if (!modules.length) { message("请先在「填写范围」里至少勾选一个模块", "error"); return; }
  // Cross-origin iframes (北森/Moka forms are often embedded) need host
  // access beyond the clicked tab; asked once, and the fill still runs on the
  // top frame if the applicant declines.
  await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false);
  filling = true;
  updateScope();
  message("正在读取页面…");
  try {
    await send("fill", { resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, expandBlocks: $("expand").checked, modules });
  } catch (err) {
    message(err.message, "error");
    filling = false;
    updateScope();
  }
});

$("cancel").addEventListener("click", () => send("cancel").catch((err) => message(err.message, "error")));

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
    const job = assistantJobs.find((p) => p.id === $("job").value);
    $("record-company").value = job?.company || (siteInfo && siteInfo.match && siteInfo.match.companyName) || "";
    $("record-title").value = job?.title || ((tab && tab.title) || "").slice(0, 80);
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
  renderDetails(msg.status.details || []);
  if (["done", "error", "preview"].includes(msg.status.phase)) renderPlan(msg.status.plan);
  message(msg.status.message, msg.status.phase === "error" ? "error" : "");
  filling = msg.status.phase !== "done" && msg.status.phase !== "error" && msg.status.phase !== "preview";
  updateScope();
});


async function loadAssistant() {
  try {
    const data = await send("context");
    assistantJobs = data.positions;
    $("job").textContent = ""; $("job").appendChild(option("", "未关联（通用填写）"));
    for (const job of data.positions) $("job").appendChild(option(job.id, `${job.company} · ${job.title}`));
    $("job").value = data.positionId || "";
    const hint = () => { const job = data.positions.find((p) => p.id === $("job").value); $("job-hint").textContent = job ? `${job.company} · ${job.title}${job.jd ? "，AI 将结合招聘要求" : "；尚未保存招聘要求"}` : "关联岗位后可生成更有针对性的回答"; };
    $("job").onchange = async () => { await send("bind", { positionId: $("job").value }); renderPlan(null); hint(); }; hint();
    const profile = await send("profile", { resumeVersionId: $("resume").value, variantId: $("variant").value });
    $("profile-cards").textContent = "";
    const labels = { name: "姓名", phone: "手机", email: "邮箱", selfIntro: "自我评价", currentCity: "现居地" };
    for (const [key, label] of Object.entries(labels)) if (profile[key]) addCopyCard({ label, value: String(profile[key]) });
    for (const key of ["education", "experiences", "projects"]) for (const [i, row] of (profile[key] || []).entries()) for (const [label, value] of Object.entries(row)) if (value) addCopyCard({ label: `${key} ${i + 1} · ${label}`, value });
  } catch (err) { message(err.message, "error"); }
}
function addCopyCard(card) { const button = document.createElement("button"); button.textContent = `${card.label}\n${card.value}`; button.onclick = () => navigator.clipboard.writeText(card.value).then(() => message("已复制")); $("profile-cards").appendChild(button); }
let previewRows = [];
let previewPlan = null;
let assistantJobs = [];
let draftTimer;
function savePreviewDraft() { clearTimeout(draftTimer); const plan = previewPlan; if (!plan) return; draftTimer = setTimeout(() => send("saveDraft", { draft: { contextKey: plan.contextKey, url: plan.url, positionId: plan.positionId, resumeVersionId: plan.resumeVersionId, variantId: plan.variantId, fields: previewRows.filter((p) => p.eligible).map(({ label, fieldKey, section, value, ref, selected, remember, edited }) => ({ label, fieldKey, section, value, ref, selected, remember, edited })) } }).catch((e) => message(`草稿保存失败：${e.message}`, "error")), 700); }
function renderPlan(plan) {
  if (plan && previewPlan?.id === plan.id) { const apply = $("plan").querySelector(".primary"); if (apply) apply.disabled = false; return; }
  clearTimeout(draftTimer);
  previewPlan = plan;
  previewRows = [];
  $("plan").hidden = !plan; $("plan").textContent = ""; if (!plan) return;
  previewRows = plan.proposals.map((p) => ({ ...p, remember: p.remember || false }));
  const title = document.createElement("strong"); title.textContent = "填写前预览 · AI 草稿需勾选"; $("plan").appendChild(title);
  for (const p of previewRows) {
    const box = document.createElement("fieldset"); box.disabled = !p.eligible;
    const label = document.createElement("label"); label.className = "check";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = p.selected; check.onchange = () => { p.selected = check.checked; p.edited = true; savePreviewDraft(); };
    label.append(check, document.createTextNode(`${p.section || ""} · ${p.label}${p.required ? " *" : ""}`)); box.appendChild(label);
    const locate = document.createElement("button"); locate.textContent = "定位字段"; locate.onclick = () => send("focus", { id: p.id }); box.appendChild(locate);
    const note = document.createElement("p"); note.className = "hint"; note.textContent = p.note + (p.maxLength ? ` · 上限 ${p.maxLength} 字` : ""); box.appendChild(note);
    if (p.eligible) {
      const select = document.createElement("select"); select.appendChild(option("", "手动编辑 / 原建议")); for (const c of plan.choices) select.appendChild(option(c.ref, c.label)); select.value = p.ref || "";
      const value = document.createElement("textarea"); value.value = p.value;
      select.onchange = () => { p.edited = true; p.ref = select.value; const c = plan.choices.find((c) => c.ref === p.ref); if (c) { p.value = c.value; value.value = c.value; check.checked = p.selected = true; } savePreviewDraft(); };
      value.oninput = () => { p.edited = true; p.value = value.value; p.ref = ""; select.value = ""; savePreviewDraft(); };
      const rememberLabel = document.createElement("label"); rememberLabel.className = "check"; const remember = document.createElement("input"); remember.type = "checkbox"; remember.checked = p.remember; remember.onchange = () => { p.edited = true; p.remember = remember.checked; savePreviewDraft(); }; rememberLabel.append(remember, document.createTextNode("记住对应资料（需先选择资料项）")); box.append(select, value, rememberLabel);
      if (p.source === "ai") { const rewrite = document.createElement("button"); rewrite.textContent = "只重写这道题"; rewrite.onclick = () => startPreview({ questionIds: [p.id], regenerate: true, previewEdits: previewRows }); box.appendChild(rewrite); }
    }
    $("plan").appendChild(box);
  }
  const upload = document.createElement("input"); upload.type = "checkbox"; upload.checked = plan.uploadResume; const uploadLabel = document.createElement("label"); uploadLabel.className = "check"; uploadLabel.append(upload, document.createTextNode("上传所选简历")); uploadLabel.hidden = !plan.uploadResume; $("plan").appendChild(uploadLabel);
  const apply = document.createElement("button"); apply.className = "primary"; apply.textContent = "确认填写所选字段"; apply.onclick = async () => { const oversize = previewRows.find((p) => p.selected && p.maxLength && p.value.length > p.maxLength); if (oversize) return message(`「${oversize.label}」超过 ${oversize.maxLength} 字，请缩短后再填`, "error"); filling = true; updateScope(); apply.disabled = true; await send("fill", { mode: "apply", planId: plan.id, approved: previewRows.filter((p) => p.selected && p.eligible).map(({ id, value, ref, remember }) => ({ id, value, ref, remember })), uploadResume: upload.checked }).catch((e) => { filling = false; updateScope(); message(e.message, "error"); }); }; $("plan").appendChild(apply); savePreviewDraft();
}
async function startPreview(extra = {}) { extra = { previewEdits: previewRows, ...extra }; await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false); filling = true; updateScope(); await send("fill", { mode: "preview", resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, modules: fillModules(), positionId: $("job").value || undefined, answerLength: Number($("answer-length").value), ...extra }).catch((e) => { filling = false; updateScope(); message(e.message, "error"); }); }
$("preview").onclick = () => startPreview();
$("sidepanel").onclick = () => chrome.sidePanel.open({ tabId: tab.id }).catch((e) => message(e.message, "error"));
$("resume").addEventListener("change", loadAssistant); $("variant").addEventListener("change", loadAssistant);
chrome.tabs.onActivated.addListener(() => { renderPlan(null); load(); });

load();
