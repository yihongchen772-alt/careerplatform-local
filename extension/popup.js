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
  return chrome.storage.local.set({ fillModules: fillModules(), fillModulesVersion: 5 });
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
  const prefs = await chrome.storage.local.get(["resumeVersionId", "variantId", "expandBlocks", "saveBlocks", "fillModules", "fillModulesVersion", "autoRemember", "autoRecord"]);
  if (Array.isArray(prefs.fillModules)) {
    if (prefs.fillModulesVersion !== 2 && ["basic", "education", "experience", "project", "questions", "other", "resume"].every((id) => prefs.fillModules.includes(id))) prefs.fillModules.push("award");
    // v3 added 校园经历: on for whoever fills 实习/工作经历 (it used to be filled as one).
    if ((prefs.fillModulesVersion ?? 0) < 3 && prefs.fillModules.includes("experience") && !prefs.fillModules.includes("campus")) prefs.fillModules.push("campus");
    // 专业技能 boxes were filled as 其他字段 before they had a module of their own.
    if ((prefs.fillModulesVersion ?? 0) < 4 && prefs.fillModules.includes("other") && !prefs.fillModules.includes("skill")) prefs.fillModules.push("skill");
    // v5 added 个人材料（证件照/成绩单/证明）: on for whoever fills 简历附件.
    if ((prefs.fillModulesVersion ?? 0) < 5 && prefs.fillModules.includes("resume") && !prefs.fillModules.includes("attachment")) prefs.fillModules.push("attachment");
    for (const input of document.querySelectorAll("[data-module]")) input.checked = prefs.fillModules.includes(input.dataset.module);
    await saveScope();
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
  $("saveBlocks").checked = prefs.saveBlocks !== false;
  $("auto-record").checked = !!prefs.autoRecord;
  const last = await send("lastStatus").catch(() => null);
  if (last && Date.now() - last.at < 10 * 60 * 1000) {
    renderDetails(last.details || []);
    renderPlan(last.plan);
    message(last.message, last.phase === "error" ? "error" : "");
    filling = last.phase !== "done" && last.phase !== "error" && last.phase !== "preview";
    updateScope();
  }
  await loadAssistant();
  $("auto-remember").checked = prefs.autoRemember !== false;
  await send("watchMemory", { enabled: $("auto-remember").checked }).catch((error) => { $("memory-state").textContent = `自动记忆未启动：${error.message}`; });
  const memory = await send("memoryStatus").catch(() => null); if (memory) renderMemoryStatus(memory);
  renderSite();
  loadBatchPanel().catch(() => {});
  if ($("agent").open) loadAgent();
}

let learnedIds = [];
function renderMemoryStatus(status) {
  $("memory-state").textContent = status.error ? `草稿或变化保存失败：${status.error}，可点「核对本页变化」重试` : `${status.draftSaved ? "网页草稿已保存到 App；" : ""}${status.pending || 0} 项待核对变化，确认前不会用于以后填写`;
  const learned = Array.isArray(status.learned) ? status.learned : [];
  learnedIds = learned.map((item) => item.id);
  $("learned-state").hidden = !learned.length;
  $("learned-undo").hidden = !learned.length;
  if (learned.length) $("learned-text").textContent = `已记进网申资料：${learned.slice(0, 4).map((item) => item.label).join("、")}${learned.length > 4 ? ` 等 ${learned.length} 项` : ""}（下次自动填）`;
}
$("learned-undo").addEventListener("click", async () => {
  if (!learnedIds.length) return;
  $("learned-undo").disabled = true;
  try {
    const result = await send("undoLearned", { ids: learnedIds });
    learnedIds = [];
    $("learned-text").textContent = result.kept ? `已撤销 ${result.undone} 项；${result.kept} 项之后在 App 里改过，保留了` : "已撤销，网申资料恢复原样";
  } catch (error) { $("learned-text").textContent = `撤销失败：${error.message}`; }
  finally { $("learned-undo").disabled = false; $("learned-undo").hidden = !learnedIds.length; }
});
$("auto-remember").addEventListener("change", async () => {
  const enabled = $("auto-remember").checked;
  try {
    if (enabled && tab?.url) await chrome.permissions.request({ origins: [`${new URL(tab.url).origin}/*`] });
    await chrome.storage.local.set({ autoRemember: enabled });
    await send("watchMemory", { enabled });
    $("memory-state").textContent = enabled ? "已开启变化检测；网页草稿同时自动保存" : "自动发现已关闭；网页草稿仍自动保存";
  } catch (error) { $("memory-state").textContent = `自动记忆设置失败：${error.message}`; }
});

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
$("saveBlocks").addEventListener("change", (e) => chrome.storage.local.set({ saveBlocks: e.target.checked }));
$("auto-record").addEventListener("change", (e) => chrome.storage.local.set({ autoRecord: e.target.checked }));
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
    await send("fill", { resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, expandBlocks: $("expand").checked, saveBlocks: $("expand").checked && $("saveBlocks").checked, modules });
  } catch (err) {
    message(err.message, "error");
    filling = false;
    updateScope();
  }
});

$("undo-fill").addEventListener("click", async () => {
  $("undo-fill").disabled = true;
  try {
    await send("undoFill");
  } catch (err) {
    message(err.message, "error");
  } finally {
    $("undo-fill").disabled = false;
  }
});

$("refill").addEventListener("click", async () => {
  const modules = fillModules();
  if (!modules.length) { message("请先在「填写范围」里至少勾选一个模块", "error"); return; }
  await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false);
  filling = true;
  updateScope();
  message("正在清掉上次自动填入的内容并重填…");
  try {
    await send("fill", { forceRefill: true, resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, expandBlocks: $("expand").checked, saveBlocks: $("expand").checked && $("saveBlocks").checked, modules });
  } catch (err) {
    message(err.message, "error");
    filling = false;
    updateScope();
  }
});

$("cancel").addEventListener("click", () => send("cancel").catch((err) => message(err.message, "error")));

$("save").addEventListener("click", async () => {
  try {
    const { pending = 0, unchanged } = await send("save");
    message(pending > 0 ? `发现 ${pending} 项可保存内容；请在 App 的账号设置中核对` : unchanged ? "这些变化已经在待核对列表中" : "没有发现完整的新内容；未修改的 AI 草稿不会进入待核对列表");
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

// The pool job the page was recognised as, linked on save while the names stay as recognised.
let recognized = null;

$("record-toggle").addEventListener("click", () => {
  const form = $("record");
  form.hidden = !form.hidden;
  if (form.hidden) return;
  const job = assistantJobs.find((p) => p.id === $("job").value);
  const company = $("record-company"), title = $("record-title"), city = $("record-city"), hint = $("record-hint");
  recognized = null;
  company.dataset.touched = title.dataset.touched = "";
  company.value = job?.company || (siteInfo && siteInfo.match && siteInfo.match.companyName) || "";
  title.value = job?.title || "";
  city.value = "";
  hint.hidden = !!job;
  (company.value ? title : company).focus();
  if (job) return;
  // Not bound to a job: read the page and the form just submitted, as the App's 网申浏览器 does.
  hint.textContent = "正在从页面识别公司和岗位…";
  const shownFor = tab && tab.url;
  send("identify").then((found) => {
    if (form.hidden || (tab && tab.url) !== shownFor) return;
    // Never over what the applicant has typed meanwhile.
    if (!company.dataset.touched && found.companyName) company.value = found.companyName;
    if (!title.dataset.touched && found.title) title.value = found.title;
    if (found.positionId) recognized = found;
    hint.textContent = found.companyName || found.title
      ? `已自动识别${found.evidence && found.evidence.length ? `（依据：${found.evidence.join("、")}）` : ""}，请核对后保存。`
      : "没能从页面识别出公司和岗位，请手动填写。";
  }).catch((err) => {
    if (!form.hidden) hint.textContent = err.code === "offline" || err.code === "unpaired" ? err.message : "没能从页面识别出公司和岗位，请手动填写。";
  });
});
for (const id of ["record-company", "record-title"]) $(id).addEventListener("input", (event) => { event.target.dataset.touched = "1"; });

$("record").addEventListener("submit", async (event) => {
  event.preventDefault();
  const companyName = $("record-company").value.trim(), title = $("record-title").value.trim(), city = $("record-city").value.trim();
  const recognizedPositionId = recognized && recognized.companyName === companyName && recognized.title === title ? recognized.positionId : undefined;
  try {
    await send("record", { companyName, title, city: city || undefined, applyUrl: tab.url, resumeVersionId: $("resume").value || undefined, recognizedPositionId });
    $("record").hidden = true;
    message(`已记入投递记录：${companyName} · ${title}。之后打开这家公司的“我的投递”页，可以一键设为进度页。`);
    renderSite();
    loadBatchPanel().catch(() => {});
  } catch (err) {
    message(err.message, "error");
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "batch-update") { renderBatchQueue(msg.queue || []); return; }
  if (msg.type === "agent-state" && tab && msg.tabId === tab.id) { applyAgentEvent(msg); return; }
  if (msg.type === "memory-status" && tab && msg.tabId === tab.id) { renderMemoryStatus(msg.status); return; }
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
    const labels = {
      name: "姓名", phone: "手机", email: "邮箱", gender: "性别", birthDate: "出生日期",
      school: "学校", major: "专业", degree: "学历", gpa: "成绩/GPA", graduationYear: "毕业年份",
      politics: "政治面貌", ethnicity: "民族", hometown: "籍贯", householdPlace: "户籍地",
      currentCity: "现居城市", preferredCities: "意向城市", targetRole: "求职意向",
      expectedSalary: "期望薪资", availableFrom: "到岗时间", english: "英语水平",
      employmentStatus: "在职状态", workYears: "工作年限", currentSalary: "当前薪资",
      noticePeriod: "离职/到岗周期", leaveReason: "离职原因", managementScale: "管理规模", nonCompete: "竞业协议",
      selfIntro: "自我评价",
    };
    for (const [key, label] of Object.entries(labels)) if (profile[key]) addCopyCard({ label, value: String(profile[key]) });
    const groupNames = {
      education: "教育经历",
      experiences: "实习/工作",
      projects: "项目经历",
      awards: "获奖荣誉",
      campus: "校园经历",
      skills: "专业技能",
      languages: "语言能力",
    };
    for (const [key, groupLabel] of Object.entries(groupNames)) {
      for (const [i, row] of (profile[key] || []).entries()) {
        for (const [fieldKey, value] of Object.entries(row)) {
          if (value) addCopyCard({ label: `${groupLabel} ${i + 1} · ${fieldKey}`, value: String(value) });
        }
      }
    }
  } catch (err) { message(err.message, "error"); }
}
function addCopyCard(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `${card.label}\n${card.value}`;
  button.onclick = async () => {
    const res = await send("insert", { value: card.value }).catch(() => null);
    if (res?.ok) {
      message(`已填入网页当前输入框${res.label ? `（${res.label}）` : ""}：${card.label}`);
      return;
    }
    await navigator.clipboard.writeText(card.value).catch(() => {});
    message(`已复制「${card.label}」${res?.reason ? `（${res.reason}）` : ""}`);
  };
  $("profile-cards").appendChild(button);
}
let previewRows = [];
let previewPlan = null;
let assistantJobs = [];
let draftTimer;
function savePreviewDraft() {
  clearTimeout(draftTimer);
  const plan = previewPlan;
  if (!plan) return;
  draftTimer = setTimeout(() => send("saveDraft", {
    draft: {
      contextKey: plan.contextKey,
      url: plan.url,
      positionId: plan.positionId,
      resumeVersionId: plan.resumeVersionId,
      variantId: plan.variantId,
      fields: previewRows.filter((p) => p.eligible).slice(0, 250).map(({ label, fieldKey, section, value, ref, selected, remember, edited }) => ({
        label: String(label || "").slice(0, 500),
        fieldKey: String(fieldKey || "").slice(0, 1000),
        ...(section ? { section: String(section).slice(0, 200) } : {}),
        value: String(value || ""),
        ref,
        selected,
        remember,
        edited,
      })),
    },
  }).catch((e) => message(`草稿保存失败：${e.message}`, "error")), 700);
}
function renderPlan(plan) {
  if (plan && previewPlan?.id === plan.id) { const apply = $("plan").querySelector(".primary"); if (apply) apply.disabled = false; return; }
  clearTimeout(draftTimer);
  previewPlan = plan;
  previewRows = [];
  $("plan").hidden = !plan; $("plan").textContent = ""; if (!plan) return;
  previewRows = plan.proposals.map((p) => ({ ...p, remember: p.remember || false }));
  const title = document.createElement("strong"); title.textContent = "填写前预览 · AI 草稿需勾选"; $("plan").appendChild(title);
  const uiById = new Map();
  for (const block of plan.blocks || []) {
    if (!block.fieldIds.some((id) => previewRows.some((row) => row.id === id && row.eligible))) continue;
    const box = document.createElement("div"); box.className = "banner";
    const label = document.createElement("label"); label.textContent = `${block.label} · 整段来源`;
    const select = document.createElement("select"); select.append(option("", "保持原建议 / 手动填写"));
    for (const choice of block.choices) select.append(option(choice.ref, choice.label));
    select.value = block.choices.find((choice) => {
      const sources = previewRows.filter((row) => block.fieldIds.includes(row.id) && row.eligible && row.ref);
      return sources.length > 0 && sources.every((row) => row.ref === choice.ref || row.ref.startsWith(choice.ref + ":"));
    })?.ref || "";
    select.disabled = !block.choices.length;
    select.onchange = () => {
      const choice = block.choices.find((entry) => entry.ref === select.value); if (!choice) return;
      for (const row of previewRows) if (block.fieldIds.includes(row.id) && row.eligible) {
        Object.assign(row, choice.values[row.id] || { value: "", ref: "" }, { selected: !!choice.values[row.id]?.value, remember: true, edited: true });
        const ui = uiById.get(row.id); if (ui) { ui.value.value = row.value; ui.select.value = row.ref; ui.check.checked = row.selected; ui.remember.checked = true; if (ui.optSelect) ui.optSelect.value = row.value; }
      }
      savePreviewDraft();
    };
    const note = document.createElement("p"); note.className = "hint"; note.textContent = block.note + "。选择后记住本页整段对应关系。";
    label.append(select); box.append(label, note); $("plan").append(box);
  }
  for (const p of previewRows) {
    const box = document.createElement("fieldset"); box.disabled = !p.eligible;
    const label = document.createElement("label"); label.className = "check";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = p.selected; check.onchange = () => { p.selected = check.checked; p.edited = true; savePreviewDraft(); };
    label.append(check, document.createTextNode(`${p.section || ""} · ${p.label}${p.required ? " *" : ""}`)); box.appendChild(label);
    const locate = document.createElement("button"); locate.textContent = "定位字段"; locate.onclick = () => send("focus", { id: p.id }); box.appendChild(locate);
    const note = document.createElement("p"); note.className = "hint"; note.textContent = p.note + (p.maxLength ? ` · 上限 ${p.maxLength} 字` : ""); box.appendChild(note);
    if (p.eligible) {
      const select = document.createElement("select"); select.appendChild(option("", "手动编辑 / 原建议")); for (const c of plan.choices) select.appendChild(option(c.ref, c.label)); select.value = p.ref || "";
      let optSelect = null;
      if (Array.isArray(p.options) && p.options.length) {
        optSelect = document.createElement("select");
        optSelect.append(option("", "从网页选项中选择…"));
        for (const optText of p.options) optSelect.append(option(optText, optText));
        if (p.options.includes(p.value)) optSelect.value = p.value;
      }
      const value = document.createElement("textarea"); value.value = p.value;
      select.onchange = () => { p.edited = true; p.ref = select.value; const c = plan.choices.find((c) => c.ref === p.ref); if (c) { p.value = c.value; value.value = c.value; check.checked = p.selected = true; if (optSelect) optSelect.value = p.options?.includes(c.value) ? c.value : ""; } savePreviewDraft(); };
      if (optSelect) {
        optSelect.onchange = () => {
          if (!optSelect.value) return;
          p.edited = true;
          p.value = optSelect.value;
          value.value = optSelect.value;
          p.ref = "";
          select.value = "";
          check.checked = p.selected = true;
          savePreviewDraft();
        };
      }
      value.oninput = () => { p.edited = true; p.value = value.value; p.ref = ""; select.value = ""; if (optSelect) optSelect.value = ""; savePreviewDraft(); };
      const rememberLabel = document.createElement("label"); rememberLabel.className = "check"; const remember = document.createElement("input"); remember.type = "checkbox"; remember.checked = p.remember; remember.onchange = () => { p.edited = true; p.remember = remember.checked; savePreviewDraft(); }; rememberLabel.append(remember, document.createTextNode("记住对应资料（需先选择资料项）"));
      box.append(select);
      if (optSelect) box.append(optSelect);
      box.append(value, rememberLabel);
      uiById.set(p.id, { value, select, check, remember, optSelect });
      if (p.source === "ai") { const rewrite = document.createElement("button"); rewrite.type = "button"; rewrite.textContent = "只重写这道题"; rewrite.onclick = () => startPreview({ questionIds: [p.id], regenerate: true, previewEdits: previewRows }); box.appendChild(rewrite); }
    }
    $("plan").appendChild(box);
  }
  const upload = document.createElement("input"); upload.type = "checkbox"; upload.checked = plan.uploadResume; const uploadLabel = document.createElement("label"); uploadLabel.className = "check"; uploadLabel.append(upload, document.createTextNode("上传所选简历")); uploadLabel.hidden = !plan.uploadResume; $("plan").appendChild(uploadLabel);
  const uploadAtt = document.createElement("input"); uploadAtt.type = "checkbox"; uploadAtt.checked = plan.uploadAttachments !== false; const uploadAttLabel = document.createElement("label"); uploadAttLabel.className = "check"; uploadAttLabel.append(uploadAtt, document.createTextNode("自动附带证件照 / 成绩单 / 证明材料")); uploadAttLabel.hidden = plan.uploadAttachments === undefined; $("plan").appendChild(uploadAttLabel);
  const apply = document.createElement("button"); apply.className = "primary"; apply.textContent = "确认填写所选字段"; apply.onclick = async () => { const oversize = previewRows.find((p) => p.selected && p.maxLength && p.value.length > p.maxLength); if (oversize) return message(`「${oversize.label}」超过 ${oversize.maxLength} 字，请缩短后再填`, "error"); filling = true; updateScope(); apply.disabled = true; await send("fill", { mode: "apply", planId: plan.id, approved: previewRows.filter((p) => p.selected && p.eligible).map(({ id, value, ref, remember }) => ({ id, value, ref, remember })), uploadResume: upload.checked, uploadAttachments: plan.uploadAttachments !== undefined ? uploadAtt.checked : undefined }).catch((e) => { filling = false; updateScope(); message(e.message, "error"); }); }; $("plan").appendChild(apply); savePreviewDraft();
}
async function startPreview(extra = {}) { extra = { previewEdits: previewRows, ...extra }; await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false); filling = true; updateScope(); await send("fill", { mode: "preview", resumeVersionId: $("resume").value || undefined, variantId: $("variant").value || undefined, modules: fillModules(), positionId: $("job").value || undefined, answerLength: Number($("answer-length").value), ...extra }).catch((e) => { filling = false; updateScope(); message(e.message, "error"); }); }
$("preview").onclick = () => startPreview();
$("sidepanel").onclick = () => chrome.sidePanel.open({ tabId: tab.id }).catch((e) => message(e.message, "error"));
$("resume").addEventListener("change", loadAssistant); $("variant").addEventListener("change", loadAssistant);
chrome.tabs.onActivated.addListener(() => { renderPlan(null); load(); });

load();


// ✨ 问小欧: the App's agent, with this tab as context. The chat stays for
// this tab while the side panel is open (chrome.storage.session).
const agentKey = () => `agent:${tab && tab.id}`;
let agentHistory = [];
let agentBusy = false;

function agentBubble(kind, text) {
  const div = document.createElement("div");
  div.className = `bubble ${kind}`;
  div.textContent = text;
  $("agent-log").appendChild(div);
  div.scrollIntoView({ block: "end" });
  return div;
}

function agentDraft(draft) {
  const box = document.createElement("div");
  box.className = "draft";
  const q = document.createElement("div"); q.className = "q"; q.textContent = draft.question;
  const a = document.createElement("div"); a.className = "a"; a.textContent = draft.answer;
  const row = document.createElement("div"); row.className = "row";
  const fill = document.createElement("button"); fill.type = "button"; fill.className = "primary"; fill.textContent = "填进这一栏";
  fill.addEventListener("click", async () => {
    try {
      let res = await send("fillField", { label: draft.question, value: draft.answer });
      if (res.needsConfirm) {
        if (!confirm("这一栏已经有内容了，用小欧写的替换掉吗？")) return;
        res = await send("fillField", { label: draft.question, value: draft.answer, overwrite: true });
      }
      if (!res.ok) return message(res.reason || "没填进去，可以复制后自己粘贴", "error");
      fill.textContent = "已填进去（再填一次）";
      message("已填进去（紫框标出），提交前再看一眼");
    } catch (error) { message(error.message, "error"); }
  });
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制";
  copy.addEventListener("click", () => navigator.clipboard.writeText(draft.answer).then(() => message("已复制")).catch(() => message("复制失败", "error")));
  row.append(fill, copy);
  box.append(q, a, row);
  $("agent-log").appendChild(box);
}

let agentWorkingText = "";
let agentWorkingEl = null;

function renderAgent() {
  $("agent-log").textContent = "";
  agentWorkingEl = null;
  for (const item of agentHistory) {
    agentBubble(item.role === "user" ? "user" : "ai", item.content);
    for (const draft of item.drafts || []) agentDraft(draft);
    if (item.actionsNote) agentBubble("working", item.actionsNote);
  }
  if (agentBusy) agentWorkingEl = agentBubble("working", agentWorkingText || "小欧在想该怎么做…");
}

function applyAgentEvent(event) {
  agentBusy = !!event.busy;
  agentWorkingText = event.working || "";
  $("agent-send").disabled = agentBusy;
  if (Array.isArray(event.history)) {
    agentHistory = event.history;
    renderAgent();
  } else if (agentBusy) {
    if (!agentWorkingEl) agentWorkingEl = agentBubble("working", agentWorkingText);
    else agentWorkingEl.textContent = agentWorkingText;
  } else if (agentWorkingEl) {
    agentWorkingEl.remove();
    agentWorkingEl = null;
  }
  if (event.error) agentBubble("error", event.error);
}

async function loadAgent() {
  if (!tab) return;
  const data = await send("agentState").catch(() => null);
  if (data) {
    agentHistory = data.history || [];
    agentBusy = !!data.state?.busy;
    agentWorkingText = data.state?.working || "";
    $("agent-send").disabled = agentBusy;
    renderAgent();
    if (data.state?.error) agentBubble("error", data.state.error);
    return;
  }
  agentHistory = (await chrome.storage.session.get(agentKey()))[agentKey()] || [];
  renderAgent();
}

async function askAgent(text) {
  const content = String(text || "").trim();
  if (!content || agentBusy) return;
  agentBusy = true;
  agentWorkingText = "小欧在想该怎么做…";
  $("agent-send").disabled = true;
  agentHistory.push({ role: "user", content });
  renderAgent();
  try {
    await send("askAgent", { text: content });
  } catch (error) {
    agentBusy = false;
    $("agent-send").disabled = false;
    agentHistory.pop();
    renderAgent();
    agentBubble("error", error.message || "小欧这次没跑完");
  }
}

$("agent-send").addEventListener("click", () => { const text = $("agent-input").value; $("agent-input").value = ""; askAgent(text); });
$("agent-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("agent-send").click(); } });
$("agent-clear").addEventListener("click", () => { agentHistory = []; agentBusy = false; agentWorkingText = ""; $("agent-send").disabled = false; renderAgent(); send("clearAgent").catch(() => {}); });
for (const chip of document.querySelectorAll("[data-ask]")) chip.addEventListener("click", () => askAgent(chip.dataset.ask));
$("agent").addEventListener("toggle", () => { if ($("agent").open) loadAgent(); });

// 批量多页投递 + 待确认清单 + 快捷导出
const BATCH_STAGE_LABEL = {
  queued: ["排队中", ""],
  filling: ["填写中", "warn"],
  ready: ["待确认", "ok"],
  needs_login: ["需登录", "warn"],
  error: ["失败", "bad"],
  confirmed: ["已记投递", "ok"],
};
const selectedBatchTabIds = new Set();

function renderBatchQueue(queue = []) {
  const pending = queue.filter((item) => item.status !== "confirmed").length;
  $("batch-badge").hidden = queue.length === 0;
  $("batch-badge").textContent = pending ? `${pending} 待处理` : `${queue.length}`;
  $("batch-queue-wrap").hidden = queue.length === 0;
  const list = $("batch-queue");
  list.textContent = "";
  for (const item of queue) {
    const card = document.createElement("div");
    card.className = "batch-queue-item";
    const meta = document.createElement("div");
    meta.className = "batch-meta";
    const title = document.createElement("span");
    title.className = "batch-title";
    title.textContent = item.companyName && item.jobTitle ? `${item.companyName} · ${item.jobTitle}` : (item.title || item.url);
    title.title = item.url;
    const [badgeText, badgeKind] = BATCH_STAGE_LABEL[item.status] || ["未知", ""];
    const pill = document.createElement("span");
    pill.className = `pill ${badgeKind}`;
    pill.textContent = badgeText;
    meta.append(title, pill);
    const msg = document.createElement("div");
    msg.className = "hint";
    msg.textContent = item.message || `已填 ${item.filled || 0} 项 / 需手填 ${item.manual || 0} 项`;
    const actions = document.createElement("div");
    actions.className = "batch-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "切到该页";
    openBtn.onclick = () => send("focusTab", { tabId: item.tabId }).catch((e) => message(e.message, "error"));
    const refillBtn = document.createElement("button");
    refillBtn.type = "button";
    refillBtn.textContent = "重填";
    refillBtn.disabled = item.status === "filling";
    refillBtn.onclick = () => {
      const modules = fillModules();
      if (!modules.length) return message("请先选择填写范围模块", "error");
      send("batchRefill", {
        tabId: item.tabId,
        resumeVersionId: $("resume").value || undefined,
        variantId: $("variant").value || undefined,
        expandBlocks: $("expand").checked,
        saveBlocks: $("expand").checked && $("saveBlocks").checked,
        modules,
      }).catch((e) => message(e.message, "error"));
    };
    const recordBtn = document.createElement("button");
    recordBtn.type = "button";
    recordBtn.className = item.status === "ready" ? "primary" : "";
    recordBtn.textContent = item.status === "confirmed" ? "已记投递" : "一键记投递";
    recordBtn.disabled = item.status === "confirmed";
    recordBtn.onclick = async () => {
      recordBtn.disabled = true;
      try {
        await send("focusTab", { tabId: item.tabId });
        const found = await send("identify", { tabId: item.tabId }).catch(() => ({}));
        if (found.companyName && found.title) {
          await send("record", {
            tabId: item.tabId,
            companyName: found.companyName,
            title: found.title,
            applyUrl: item.url,
            resumeVersionId: $("resume").value || undefined,
            recognizedPositionId: found.positionId,
          });
          message(`已记入投递记录：${found.companyName} · ${found.title}`);
        } else {
          $("record").hidden = false;
          if (found.companyName) $("record-company").value = found.companyName;
          if (found.title) $("record-title").value = found.title;
          $("record-hint").hidden = false;
          $("record-hint").textContent = "已切到该标签页，请补充公司或岗位名后保存。";
        }
      } catch (e) {
        recordBtn.disabled = false;
        message(e.message, "error");
      }
    };
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.onclick = () => send("batchRemove", { tabId: item.tabId }).then((res) => renderBatchQueue(res.queue || [])).catch(() => {});
    actions.append(openBtn, refillBtn, recordBtn, removeBtn);
    card.append(meta, msg, actions);
    list.appendChild(card);
  }
}

async function loadBatchPanel() {
  const { tabs = [], queue = [] } = await send("listTabs");
  const container = $("batch-tabs");
  container.textContent = "";
  if (!tabs.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "当前窗口没有打开可填写的招聘网页标签页。";
    container.appendChild(empty);
  } else {
    for (const t of tabs) {
      if (t.active && selectedBatchTabIds.size === 0) selectedBatchTabIds.add(t.id);
      const wrap = document.createElement("div");
      wrap.className = "batch-item";
      const label = document.createElement("label");
      label.className = "check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(t.id);
      cb.checked = selectedBatchTabIds.has(t.id);
      cb.onchange = () => {
        if (cb.checked) selectedBatchTabIds.add(t.id);
        else selectedBatchTabIds.delete(t.id);
      };
      const text = document.createElement("span");
      text.className = "batch-title";
      text.textContent = t.title || t.url;
      text.title = t.url;
      label.append(cb, text);
      wrap.appendChild(label);
      container.appendChild(wrap);
    }
  }
  renderBatchQueue(queue);
}

$("batch").addEventListener("toggle", () => { if ($("batch").open) loadBatchPanel().catch(() => {}); });
$("batch-refresh").addEventListener("click", () => loadBatchPanel().catch((e) => message(e.message, "error")));
$("batch-all").addEventListener("click", () => {
  const inputs = $("batch-tabs").querySelectorAll("input[type='checkbox']");
  const allChecked = inputs.length > 0 && Array.from(inputs).every((cb) => cb.checked);
  for (const cb of inputs) {
    cb.checked = !allChecked;
    const id = Number(cb.value);
    if (cb.checked) selectedBatchTabIds.add(id);
    else selectedBatchTabIds.delete(id);
  }
});
$("batch-run").addEventListener("click", async () => {
  const ids = Array.from($("batch-tabs").querySelectorAll("input[type='checkbox']:checked"), (cb) => Number(cb.value));
  if (!ids.length) return message("请先勾选要批量填写的网申标签页", "error");
  const modules = fillModules();
  if (!modules.length) return message("请先在「填写范围」里至少勾选一个模块", "error");
  await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }).catch(() => false);
  const res = await send("batchFill", {
    tabIds: ids,
    resumeVersionId: $("resume").value || undefined,
    variantId: $("variant").value || undefined,
    expandBlocks: $("expand").checked,
    saveBlocks: $("expand").checked && $("saveBlocks").checked,
    modules,
  });
  renderBatchQueue(res.queue || []);
  message(`已将 ${ids.length} 个标签页加入批量填写队列`);
});
$("batch-clear-done").addEventListener("click", () => send("batchClearDone").then((res) => renderBatchQueue(res.queue || [])).catch(() => {}));

async function exportRecords(format, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正在导出…";
  try {
    const { appBase, token } = await chrome.storage.local.get(["appBase", "token"]);
    if (!token) throw new Error("请先连接求职罗盘 App");
    const res = await fetch(`${appBase || "http://localhost:3210"}/api/extension/export?format=${encodeURIComponent(format)}`, {
      headers: { "x-jobcompass-token": token },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "导出失败");
    const blob = await res.blob();
    const header = res.headers.get("content-disposition") || "";
    const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
    const filename = utfMatch ? decodeURIComponent(utfMatch[1]) : `已投递企业与岗位.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    message(`已导出：${filename}`);
  } catch (err) {
    message(err.message || "导出失败", "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
$("export-xlsx").addEventListener("click", () => exportRecords("xlsx", $("export-xlsx")));
$("export-csv").addEventListener("click", () => exportRecords("csv", $("export-csv")));
