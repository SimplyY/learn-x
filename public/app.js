import { APP_CONFIG } from "./config.js";

const STORAGE_PREFIX = "learn-x";
const SCENARIOS = APP_CONFIG.learningScenarios;

const state = {
  mode: initialMode(),
  files: [],
  sources: [],
  domains: [],
  prompts: {},
  currentPath: "",
  context: "",
  activeScenarioId: SCENARIOS[0]?.id || "",
  selectedDomain: "",
  selectedSources: new Set(),
  chatPack: ""
};

const els = {
  brandMark: document.querySelector("#brandMark"),
  brandTitle: document.querySelector("#brandTitle"),
  brandSubtitle: document.querySelector("#brandSubtitle"),
  topNav: document.querySelector("#topNav"),
  tree: document.querySelector("#tree"),
  reader: document.querySelector("#reader"),
  currentPath: document.querySelector("#currentPath"),
  currentTitle: document.querySelector("#currentTitle"),
  readerCurrentFile: document.querySelector("#readerCurrentFile"),
  fileCount: document.querySelector("#fileCount"),
  contextFileCount: document.querySelector("#contextFileCount"),
  contextSize: document.querySelector("#contextSize"),
  status: document.querySelector("#statusText"),
  learningStatus: document.querySelector("#learningStatus"),
  search: document.querySelector("#searchInput"),
  preview: document.querySelector("#preview"),
  browseModule: document.querySelector("#browseModule"),
  readerWorkspace: document.querySelector("#readerWorkspace"),
  learningWorkspace: document.querySelector("#learningWorkspace"),
  actionWorkspace: document.querySelector("#actionWorkspace"),
  actionEyebrow: document.querySelector("#actionEyebrow"),
  actionTitle: document.querySelector("#actionTitle"),
  actionDescription: document.querySelector("#actionDescription"),
  scenarioList: document.querySelector("#scenarioList"),
  scenarioEyebrow: document.querySelector("#scenarioEyebrow"),
  scenarioTitle: document.querySelector("#scenarioTitle"),
  domainField: document.querySelector("#domainField"),
  domainSelect: document.querySelector("#domainSelect"),
  sourceChecklist: document.querySelector("#sourceChecklist"),
  resetSources: document.querySelector("#resetSourcesBtn"),
  metaPrompt: document.querySelector("#metaPrompt"),
  insightLog: document.querySelector("#insightLog"),
  progressBar: document.querySelector("#progressBar"),
  currentQuestion: document.querySelector("#currentQuestion"),
  chatPackPreview: document.querySelector("#chatPackPreview"),
  generateChatPack: document.querySelector("#generateChatPackBtn"),
  resetPrompt: document.querySelector("#resetPromptBtn"),
  copyLog: document.querySelector("#copyLogBtn"),
  clearLog: document.querySelector("#clearLogBtn")
};

async function boot() {
  applyAppConfig();
  const graph = await getJson("api/graph");
  state.files = graph.files;
  state.sources = graph.sources;
  state.domains = graph.domains;
  state.prompts = graph.prompts || {};
  state.selectedDomain = state.domains[0] || "";

  els.fileCount.textContent = String(graph.files.length);
  renderTree(graph.files);
  renderDomains();
  renderTopNav();
  renderScenarios();
  bindEvents();
  applyScenario(state.activeScenarioId);
  setMode(state.mode);
  window.addEventListener("hashchange", applyModeFromRoute);

  const first = graph.files.find((file) => file.path === "README.md") || graph.files[0];
  if (first) await openFile(first.path);
}

async function getJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  } catch (error) {
    return getStaticJson(url, error);
  }
}

async function getStaticJson(url, originalError) {
  const parsedUrl = new URL(url, window.location.href);
  if (parsedUrl.pathname.endsWith("/api/graph")) {
    const response = await fetch("data/graph.json");
    if (!response.ok) throw originalError;
    return response.json();
  }

  if (parsedUrl.pathname.endsWith("/api/file")) {
    const filePath = parsedUrl.searchParams.get("path");
    const file = state.files.find((item) => item.path === filePath);
    if (!file) throw originalError;
    return {
      path: file.path,
      title: file.title,
      content: file.content || "",
      html: file.html || "",
      links: file.links || []
    };
  }

  if (parsedUrl.pathname.endsWith("/api/context")) {
    const includes = parsedUrl.searchParams.getAll("include").filter(Boolean);
    const scene = parsedUrl.searchParams.get("scene") || "learn-x";
    const selectedFiles = filterFilesByIncludes(state.files, includes);
    const content = buildContext(selectedFiles, scene);
    return {
      fileName: "CONTEXT_MASTER.md",
      generatedAt: new Date().toISOString(),
      fileCount: selectedFiles.length,
      bytes: new Blob([content]).size,
      includedPaths: selectedFiles.map((file) => file.path),
      content
    };
  }

  throw originalError;
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    const query = els.search.value.trim().toLowerCase();
    renderTree(
      query
        ? state.files.filter((file) =>
            `${file.path}\n${file.title}\n${file.preview}`.toLowerCase().includes(query)
          )
        : state.files
    );
  });

  els.domainSelect.addEventListener("change", () => {
    state.selectedDomain = els.domainSelect.value;
    applyScenario(state.activeScenarioId);
  });

  els.resetSources.addEventListener("click", () => {
    applyRecommendedSources();
    renderSourceChecklist();
    resetGeneratedContext("已恢复该场景推荐的上下文路径。");
  });

  els.generateChatPack.addEventListener("click", generateChatPack);
  els.resetPrompt.addEventListener("click", resetPrompt);
  els.copyLog.addEventListener("click", () => copyText(els.insightLog.value, "更新日志已复制。"));
  els.clearLog.addEventListener("click", clearInsightLog);

  els.metaPrompt.addEventListener("input", () => {
    localStorage.setItem(promptKey(), els.metaPrompt.value);
    els.learningStatus.textContent = "场景 Prompt 已在本机保存。";
    renderChatPackPreview();
  });

  els.currentQuestion.addEventListener("input", () => {
    localStorage.setItem(questionKey(), els.currentQuestion.value);
    renderChatPackPreview();
  });

  els.insightLog.addEventListener("input", () => {
    localStorage.setItem(logKey(), els.insightLog.value);
  });
}

function applyAppConfig() {
  els.brandMark.textContent = APP_CONFIG.brand.mark;
  els.brandTitle.textContent = APP_CONFIG.brand.title;
  els.brandSubtitle.textContent = APP_CONFIG.brand.subtitle;
}

function renderTopNav() {
  els.topNav.innerHTML = "";
  for (const item of APP_CONFIG.menu) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `top-nav-btn${item.id === state.mode ? " active" : ""}`;
    button.dataset.mode = item.id;
    button.textContent = item.label;
    button.addEventListener("click", () => navigateMode(item.id));
    els.topNav.append(button);
  }
}

function initialMode() {
  const hashMode = window.location.hash.replace(/^#\/?/, "");
  return APP_CONFIG.menu.some((item) => item.id === hashMode)
    ? hashMode
    : APP_CONFIG.menu[0]?.id || "browse";
}

function navigateMode(mode) {
  const nextHash = `#${mode}`;
  if (window.location.hash === nextHash) {
    setMode(mode);
    return;
  }
  window.location.hash = mode;
}

function applyModeFromRoute() {
  setMode(initialMode());
}

function setMode(mode) {
  state.mode = mode;
  const activeMenu = getMenuItem(mode);
  const module = activeMenu?.module || mode;
  els.browseModule.hidden = module !== "browse";
  els.learningWorkspace.hidden = module !== "learning";
  els.actionWorkspace.hidden = module !== "action";
  els.topNav.querySelectorAll(".top-nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (module === "browse") {
    els.currentPath.textContent = state.currentPath || "Browse Mode";
    els.currentTitle.textContent = currentFileTitle();
  }
  if (module === "action") {
    els.actionEyebrow.textContent = `${activeMenu.label} Mode`;
    els.actionTitle.textContent = activeMenu.title || activeMenu.label;
    els.actionDescription.textContent = activeMenu.placeholder || "该模块已预留，可在 config.js 中继续配置。";
  }
}

function getMenuItem(mode) {
  return APP_CONFIG.menu.find((item) => item.id === mode) || APP_CONFIG.menu[0];
}

function getMenuIdByModule(moduleName) {
  return APP_CONFIG.menu.find((item) => item.module === moduleName)?.id || moduleName;
}

function currentModule() {
  return getMenuItem(state.mode)?.module || state.mode;
}

function renderTree(files) {
  els.tree.innerHTML = "";
  const groups = new Map();

  for (const file of files) {
    const group = file.path.includes("/") ? file.path.split("/")[0] : "根目录";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(file);
  }

  for (const [group, groupFiles] of groups) {
    const section = document.createElement("div");
    section.className = "tree-section";
    section.textContent = group;
    els.tree.append(section);

    for (const file of groupFiles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-btn${file.path === state.currentPath ? " active" : ""}`;
      button.textContent = file.path.replace(`${group}/`, "");
      button.title = file.path;
      button.addEventListener("click", () => {
        navigateMode(getMenuIdByModule("browse"));
        openFile(file.path);
      });
      els.tree.append(button);
    }
  }
}

function renderDomains() {
  els.domainSelect.innerHTML = "";
  for (const domain of state.domains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain;
    els.domainSelect.append(option);
  }
}

function renderScenarios() {
  els.scenarioList.innerHTML = "";
  for (const scenario of SCENARIOS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `scenario-btn${scenario.id === state.activeScenarioId ? " active" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(scenario.title)}</strong><span>${escapeHtml(scenario.subtitle)}</span>`;
    button.addEventListener("click", () => applyScenario(scenario.id));
    els.scenarioList.append(button);
  }
}

async function openFile(filePath) {
  const file = await getJson(`api/file?path=${encodeURIComponent(filePath)}`);
  state.currentPath = file.path;
  els.currentPath.textContent = file.path;
  els.currentTitle.textContent = file.title;
  els.readerCurrentFile.textContent = file.path;
  els.reader.innerHTML = file.html;
  renderTree(filteredFiles());
  attachPreviewHandlers();
  els.status.textContent = `已读取 ${file.path}`;
}

function filteredFiles() {
  const query = els.search.value.trim().toLowerCase();
  if (!query) return state.files;
  return state.files.filter((item) =>
    `${item.path}\n${item.title}\n${item.preview}`.toLowerCase().includes(query)
  );
}

function currentFileTitle() {
  const file = state.files.find((item) => item.path === state.currentPath);
  return file?.title || "Learn-X";
}

function applyScenario(scenarioId) {
  state.activeScenarioId = scenarioId;
  const scenario = activeScenario();
  els.scenarioEyebrow.textContent = scenario.needsDomain
    ? `Learning Mode · ${state.selectedDomain || "未发现领域"}`
    : "Learning Mode · 全仓库";
  els.scenarioTitle.textContent = scenario.title;
  els.domainField.hidden = !scenario.needsDomain;
  els.metaPrompt.value = localStorage.getItem(promptKey()) || renderPromptTemplate(getScenarioPrompt(scenario));
  els.currentQuestion.value = localStorage.getItem(questionKey()) || "";
  els.insightLog.value = localStorage.getItem(logKey()) || "";
  applyRecommendedSources();
  renderScenarios();
  renderSourceChecklist();
  resetGeneratedContext("已切换学习场景。");
}

function activeScenario() {
  return SCENARIOS.find((scenario) => scenario.id === state.activeScenarioId) || SCENARIOS[0];
}

function renderPromptTemplate(template) {
  return template.replaceAll("{{domain}}", state.selectedDomain || "当前领域");
}

function getScenarioPrompt(scenario) {
  return state.prompts[scenario.id] || scenario.prompt || "";
}

function promptKey() {
  return `${STORAGE_PREFIX}:prompt:${state.activeScenarioId}:${state.selectedDomain || "global"}`;
}

function questionKey() {
  return `${STORAGE_PREFIX}:question:${state.activeScenarioId}:${state.selectedDomain || "global"}`;
}

function logKey() {
  return `${STORAGE_PREFIX}:log:${state.activeScenarioId}:${state.selectedDomain || "global"}`;
}

function applyRecommendedSources() {
  const scenario = activeScenario();
  const recommended =
    scenario.recommendedSources === "all"
      ? state.sources.map((source) => source.path)
      : (scenario.recommendedSources || []).map((sourcePath) => renderPromptTemplate(sourcePath));
  state.selectedSources = new Set(
    recommended.filter((sourcePath) => state.sources.some((source) => source.path === sourcePath))
  );
}

function renderSourceChecklist() {
  els.sourceChecklist.innerHTML = "";
  for (const source of state.sources) {
    const id = `source-${source.path.replaceAll("/", "-")}`;
    const label = document.createElement("label");
    label.className = "source-item";
    label.htmlFor = id;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.value = source.path;
    input.checked = state.selectedSources.has(source.path);
    input.addEventListener("change", () => {
      if (input.checked) state.selectedSources.add(source.path);
      else state.selectedSources.delete(source.path);
      resetGeneratedContext("上下文切片已更新，请重新生成。");
    });

    const text = document.createElement("span");
    text.textContent = source.label;
    label.append(input, text);
    els.sourceChecklist.append(label);
  }
}

async function generateContext() {
  const includes = [...state.selectedSources];
  if (!includes.length) {
    els.learningStatus.textContent = "请至少选择一个上下文来源。";
    return;
  }

  setProgress(18);
  els.learningStatus.textContent = "正在扫描并切片 Markdown。";
  const params = new URLSearchParams({ scene: activeScenario().title });
  for (const include of includes) params.append("include", include);

  setProgress(48);
  const payload = await getJson(`api/context?${params.toString()}`);
  setProgress(82);
  state.context = payload.content;
  els.contextFileCount.textContent = String(payload.fileCount);
  els.contextSize.textContent = `${formatBytes(payload.bytes)}`;
  setProgress(100);
  els.learningStatus.textContent = `已生成 ${payload.fileCount} 个文件的学习上下文。`;
  renderChatPackPreview();
}

function resetGeneratedContext(message) {
  state.context = "";
  els.contextFileCount.textContent = "0";
  els.contextSize.textContent = "未生成";
  setProgress(0);
  els.learningStatus.textContent = message;
  renderChatPackPreview();
}

function setProgress(value) {
  els.progressBar.style.width = `${value}%`;
}

function getCurrentPrompt() {
  return els.metaPrompt.value.trim();
}

function resetPrompt() {
  els.metaPrompt.value = renderPromptTemplate(getScenarioPrompt(activeScenario()));
  localStorage.removeItem(promptKey());
  els.learningStatus.textContent = "场景 Prompt 已恢复为模板。";
  renderChatPackPreview();
}

function clearInsightLog() {
  els.insightLog.value = "";
  localStorage.removeItem(logKey());
  els.learningStatus.textContent = "更新日志已清空。";
}

async function generateChatPack() {
  await generateContext();
  if (!state.context) return;
  const chatPack = buildChatPack();
  await copyText(chatPack, "Chat Pack 已生成并复制。");
}

function buildChatPack() {
  const question = els.currentQuestion.value.trim() || "（未填写）";
  const prompt = getCurrentPrompt() || "（未选择 Prompt）";
  const context = state.context || "（Context 尚未生成）";

  state.chatPack = `# Chat Pack

## 当前问题

${question}

## Prompt

${prompt}

## Context

${context}

## 输出要求

请基于以上 Prompt 与 Context 回答当前问题；若上下文不足，请明确指出缺口、反例和下一步验证方式。
`;
  return state.chatPack;
}

function filterFilesByIncludes(files, includes) {
  if (!includes.length) return files;
  return files.filter((file) =>
    includes.some((includePath) => file.path === includePath || file.path.startsWith(`${includePath}/`))
  );
}

function buildContext(files, label = "Learn-X") {
  const generatedAt = new Date().toISOString();
  const body = files
    .map((file) => `## ${file.path}\n\n${demoteMarkdownHeadings((file.content || "").trim())}\n`)
    .join("\n---\n\n");

  return `# CONTEXT_MASTER\n\nSource: ${label}\nGenerated from Learn-X at ${generatedAt}.\n\n${body}\n`;
}

function demoteMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (_match, hashes) => {
    const level = Math.min(hashes.length + 2, 6);
    return `${"#".repeat(level)} `;
  });
}

function renderChatPackPreview() {
  els.chatPackPreview.value = buildChatPack();
}

async function copyText(text, message) {
  await navigator.clipboard.writeText(text);
  const target = currentModule() === "learning" ? els.learningStatus : els.status;
  target.textContent = message;
}

function attachPreviewHandlers() {
  document.querySelectorAll(".wiki-link").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const target = resolveTarget(link.dataset.target);
      if (target) await openFile(target.path);
    });

    link.addEventListener("mouseenter", (event) => showPreview(event.currentTarget));
    link.addEventListener("mouseleave", hidePreview);
  });
}

function resolveTarget(target) {
  const normalized = target.replace(/\.md$/, "");
  return (
    state.files.find((file) => file.path === target) ||
    state.files.find((file) => file.path.replace(/\.md$/, "") === normalized) ||
    state.files.find((file) => file.title === target) ||
    state.files.find((file) => file.path.endsWith(`${target}.md`))
  );
}

function showPreview(node) {
  const target = resolveTarget(node.dataset.target);
  if (!target) {
    els.preview.innerHTML = `<strong>未找到双链</strong><span>${escapeHtml(node.dataset.target)}</span>`;
  } else {
    els.preview.innerHTML = `<strong>${escapeHtml(target.path)}</strong>${target.previewHtml || ""}`;
  }

  const rect = node.getBoundingClientRect();
  els.preview.hidden = false;
  const left = Math.min(rect.left, window.innerWidth - 380);
  els.preview.style.left = `${Math.max(16, left)}px`;
  els.preview.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - 180)}px`;
}

function hidePreview() {
  els.preview.hidden = true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

boot().catch((error) => {
  els.status.textContent = error.message;
});
