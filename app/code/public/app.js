const STORAGE_PREFIX = "learn-x";
const MUNGER_SOUL_ENHANCER_ID = "munger-soul";
const MUNGER_SOUL_SUBTYPE_ID = "other-prompts.munger-soul";
const MUNGER_SOUL_QUESTION = "使用芒格之魂的提示词来解析所有上下文。";
const MUNGER_SOUL_PERIOD_LENGTH_ID = "length-1000";
const MUNGER_SOUL_PERIOD_QUESTIONS = {
  weekly: "使用芒格之魂的提示词来解析所有上下文。不要输出 Weekly Output，仅洞察。",
  monthly: "使用芒格之魂的提示词来解析所有上下文。不要输出 Monthly Output，仅洞察。",
  yearly: "使用芒格之魂的提示词来解析所有上下文。不要输出 Yearly Output，仅洞察。"
};
const GRAPH_DATA_URL = window.LEARN_X_GRAPH_URL || "data/graph.json";
let APP_CONFIG = {
  brand: { title: "Learn-X", subtitle: "认知进化系统", mark: "LX" },
  promptDirectory: "01_meta-prompts",
  menu: [
    { id: "browse", label: "知", module: "browse", title: "知识库浏览" },
    { id: "learning", label: "学", module: "learning", title: "认知进化系统" },
    { id: "action", label: "行", module: "action", title: "行动动力引擎" }
  ]
};
let CHATPACK_CONFIG = {
  contextBudget: {
    recommendedRatio: 2 / 3,
    recommendedChineseChars: 30000,
    tokensPerChineseChar: 1.8,
    latinCharsPerToken: 4,
    models: [{ id: "chatgpt-gemini", label: "ChatGPT Thinking / Gemini Pro", contextTokens: 1000000 }]
  },
  dialogueTypes: [],
  enhancers: []
};
let DIALOGUE_TYPES = CHATPACK_CONFIG.dialogueTypes;
let ENHANCERS = CHATPACK_CONFIG.enhancers;
const PERIOD_OUTPUTS = {
  weekly: {
    subtypeId: "reflective-decision.weekly-output",
    label: "第几周",
    emptyLabel: "暂无周输出包",
    pattern: /^04_output\/_dist\/weekly\/(\d{4})-W(\d{2})\//,
    valueFromMatch: (match) => `${match[1]}-W${match[2]}`,
    labelFromValue: (value) => {
      const match = value.match(/^(\d{4})-W(\d{2})$/);
      return match ? `${match[1]} 年第 ${Number(match[2])} 周` : value;
    },
    prefixFromValue: (value) => `04_output/_dist/weekly/${value}/`
  },
  monthly: {
    subtypeId: "reflective-decision.monthly-output",
    label: "第几月",
    emptyLabel: "暂无月输出包",
    pattern: /^04_output\/_dist\/monthly\/(\d{4})-(\d{2})\//,
    valueFromMatch: (match) => `${match[1]}-${match[2]}`,
    labelFromValue: (value) => {
      const match = value.match(/^(\d{4})-(\d{2})$/);
      return match ? `${match[1]} 年第 ${Number(match[2])} 月` : value;
    },
    prefixFromValue: (value) => `04_output/_dist/monthly/${value}/`
  },
  yearly: {
    subtypeId: "reflective-decision.yearly-output",
    label: "第几年",
    emptyLabel: "暂无年输出包",
    pattern: /^04_output\/_dist\/yearly\/(\d{4})\//,
    valueFromMatch: (match) => match[1],
    optionPatterns: [
      {
        pattern: /^04_output\/monthly\/(\d{4})-\d{2}\.md$/,
        valueFromMatch: (match) => match[1]
      }
    ],
    labelFromValue: (value) => `${value} 年`,
    prefixFromValue: (value) => `04_output/_dist/yearly/${value}/`
  }
};

const state = {
  mode: initialMode(),
  files: [],
  sources: [],
  contextFiles: [],
  customContextFiles: [],
  contextFileMap: new Map(),
  domains: [],
  prompts: {},
  currentPath: "",
  context: "",
  activeDialogueTypeId: "",
  activeDialogueSubtypeId: "",
  activeEnhancerIds: new Set(),
  activePeriodValues: {},
  selectedDomain: "",
  contextSelections: new Map(),
  customDraftSelections: new Set(),
  expandedContextDirs: new Set(["", "01_core", "01_core/道", "01_core/法"]),
  expandedContextFilePreviews: new Set(),
  currentQuestionTouched: false,
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
  selectedContextSummary: document.querySelector("#selectedContextSummary"),
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
  scenarioEyebrow: document.querySelector("#scenarioEyebrow"),
  scenarioTitle: document.querySelector("#scenarioTitle"),
  domainField: document.querySelector("#domainField"),
  domainSelect: document.querySelector("#domainSelect"),
  dialogueTypeList: document.querySelector("#dialogueTypeList"),
  dialogueSubtypeList: document.querySelector("#dialogueSubtypeList"),
  periodPicker: document.querySelector("#periodPicker"),
  periodPickerLabel: document.querySelector("#periodPickerLabel"),
  periodSelect: document.querySelector("#periodSelect"),
  enhancerList: document.querySelector("#enhancerList"),
  sourceChecklist: document.querySelector("#sourceChecklist"),
  selectAllSources: document.querySelector("#selectAllSourcesBtn"),
  invertSources: document.querySelector("#invertSourcesBtn"),
  customSources: document.querySelector("#customSourcesBtn"),
  resetSources: document.querySelector("#resetSourcesBtn"),
  metaPrompt: document.querySelector("#metaPrompt"),
  insightLog: document.querySelector("#insightLog"),
  progressBar: document.querySelector("#progressBar"),
  currentQuestion: document.querySelector("#currentQuestion"),
  chatPackFramePreview: document.querySelector("#chatPackFramePreview"),
  chatPackContextSummary: document.querySelector("#chatPackContextSummary"),
  chatPackPreview: document.querySelector("#chatPackPreview"),
  chatPackMetrics: document.querySelector("#chatPackMetrics"),
  chatPackWarning: document.querySelector("#chatPackWarning"),
  contextBudgetList: document.querySelector("#contextBudgetList"),
  generateChatPack: document.querySelector("#generateChatPackBtn"),
  resetPrompt: document.querySelector("#resetPromptBtn"),
  copyLog: document.querySelector("#copyLogBtn"),
  clearLog: document.querySelector("#clearLogBtn"),
  customContextDialog: document.querySelector("#customContextDialog"),
  closeCustomContext: document.querySelector("#closeCustomContextBtn"),
  customContextSearch: document.querySelector("#customContextSearch"),
  customContextList: document.querySelector("#customContextList"),
  customContextCount: document.querySelector("#customContextCount"),
  selectAllCustomContext: document.querySelector("#selectAllCustomContextBtn"),
  clearCustomContext: document.querySelector("#clearCustomContextBtn"),
  applyCustomContext: document.querySelector("#applyCustomContextBtn")
};

async function boot() {
  const graph = await loadGraph();
  APP_CONFIG = graph.appConfig || APP_CONFIG;
  CHATPACK_CONFIG = graph.chatPackConfig || CHATPACK_CONFIG;
  DIALOGUE_TYPES = CHATPACK_CONFIG.dialogueTypes || [];
  ENHANCERS = CHATPACK_CONFIG.enhancers || [];
  state.mode = initialMode();
  state.activeDialogueTypeId =
    localStorage.getItem(dialogueTypeKey()) || state.activeDialogueTypeId || DIALOGUE_TYPES[0]?.id || "";
  let migratedDialogueSubtypeId = "";
  if (state.activeDialogueTypeId === "plain-context") state.activeDialogueTypeId = "other-prompts";
  if (state.activeDialogueTypeId === "create-execute") {
    const legacySubtypeId = localStorage.getItem(dialogueSubtypeKey("create-execute")) || "";
    state.activeDialogueTypeId = "reflective-decision";
    migratedDialogueSubtypeId = legacySubtypeId.replace(/^create-execute\./, "reflective-decision.");
    localStorage.setItem(dialogueTypeKey(), state.activeDialogueTypeId);
    if (migratedDialogueSubtypeId) {
      localStorage.setItem(dialogueSubtypeKey(state.activeDialogueTypeId), migratedDialogueSubtypeId);
    }
  }
  if (!DIALOGUE_TYPES.some((type) => type.id === state.activeDialogueTypeId)) {
    state.activeDialogueTypeId = DIALOGUE_TYPES[0]?.id || "";
  }
  state.activeDialogueSubtypeId =
    migratedDialogueSubtypeId || localStorage.getItem(dialogueSubtypeKey(state.activeDialogueTypeId)) || "";
  state.activeEnhancerIds = new Set(readEnhancerIds());
  ensureActiveDialogueSubtype();
  applyAppConfig();
  state.files = graph.files;
  state.sources = graph.sources;
  state.contextFiles = graph.contextFiles || graph.files || [];
  state.customContextFiles = graph.customContextFiles || state.contextFiles;
  state.contextFileMap = new Map([...state.contextFiles, ...state.customContextFiles].map((file) => [file.path, file]));
  state.domains = graph.domains;
  state.prompts = graph.prompts || {};
  state.selectedDomain = state.domains[0] || "";

  els.fileCount.textContent = String(graph.files.length);
  renderTree(graph.files);
  renderDomains();
  renderDialogueTypes();
  renderEnhancers();
  renderTopNav();
  bindEvents();
  applyChatPackSelection("已加载 Chat Pack 类型体系。");
  setMode(state.mode);
  window.addEventListener("hashchange", applyModeFromRoute);

  const first = graph.files.find((file) => file.path === "README.md") || graph.files[0];
  if (first) await openFile(first.path);
}

async function loadGraph() {
  if (window.LEARN_X_GRAPH) return window.LEARN_X_GRAPH;
  const response = await fetch(GRAPH_DATA_URL);
  if (!response.ok) throw new Error(`Static graph missing: ${response.status}`);
  return response.json();
}

async function getJson(url) {
  const parsedUrl = new URL(url, window.location.href);
  if (parsedUrl.pathname.endsWith("/api/file")) {
    const filePath = parsedUrl.searchParams.get("path");
    const file = state.files.find((item) => item.path === filePath);
    if (!file) throw new Error(`File not found in static graph: ${filePath}`);
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

  throw new Error(`Static route not found: ${url}`);
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
    applyChatPackSelection("研究领域已更新。");
  });

  els.resetSources.addEventListener("click", () => {
    applyRecommendedSources();
    const mode = activePeriodOutputMode();
    if (mode) applyPeriodContextSelection(mode, state.activePeriodValues[mode]);
    resetExpandedContextDirs();
    renderSourceChecklist();
    resetGeneratedContext("已恢复该场景推荐的上下文路径。");
  });
  els.selectAllSources.addEventListener("click", selectAllContextSources);
  els.invertSources.addEventListener("click", invertContextSources);
  els.customSources.addEventListener("click", openCustomContextDialog);
  els.closeCustomContext.addEventListener("click", () => els.customContextDialog.close());
  els.customContextSearch.addEventListener("input", renderCustomContextList);
  els.selectAllCustomContext.addEventListener("click", selectAllVisibleCustomContext);
  els.clearCustomContext.addEventListener("click", () => {
    state.customDraftSelections = new Set();
    renderCustomContextList();
  });
  els.applyCustomContext.addEventListener("click", applyCustomContextSelections);

  els.generateChatPack.addEventListener("click", generateChatPack);
  els.resetPrompt.addEventListener("click", resetPrompt);
  els.copyLog.addEventListener("click", () => copyText(els.insightLog.value, "更新日志已复制。"));
  els.clearLog.addEventListener("click", clearInsightLog);
  els.periodSelect.addEventListener("change", () => {
    const mode = activePeriodOutputMode();
    if (!mode) return;
    state.activePeriodValues[mode] = els.periodSelect.value;
    applyRecommendedSources();
    const count = applyPeriodContextSelection(mode, els.periodSelect.value);
    resetExpandedContextDirs();
    renderSourceChecklist();
    resetGeneratedContext(count ? `已选择${PERIOD_OUTPUTS[mode].label}：${selectedPeriodLabel(mode)}。` : "未找到对应周期过程包。");
  });

  els.currentQuestion.addEventListener("input", () => {
    state.currentQuestionTouched = true;
    renderChatPackPreview();
  });

  els.metaPrompt.addEventListener("input", () => {
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

function renderDialogueTypes() {
  els.dialogueTypeList.innerHTML = "";
  for (const type of DIALOGUE_TYPES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dialogue-type-btn${type.id === state.activeDialogueTypeId ? " active" : ""}`;
    button.title = type.useCases || type.name;
    button.innerHTML = `
      <strong>${escapeHtml(type.name)}</strong>
      <span>${escapeHtml(type.outputGoal || type.useCases || "")}</span>
    `;
    button.addEventListener("click", () => {
      if (type.id === state.activeDialogueTypeId) return;
      state.activeDialogueTypeId = type.id;
      state.activeDialogueSubtypeId = localStorage.getItem(dialogueSubtypeKey(type.id)) || "";
      ensureActiveDialogueSubtype();
      localStorage.setItem(dialogueTypeKey(), state.activeDialogueTypeId);
      renderDialogueTypes();
      renderEnhancers();
      applyChatPackSelection(`大类已切换为「${type.name}」。`);
    });
    els.dialogueTypeList.append(button);
  }
  renderDialogueSubtypes();
}

function renderDialogueSubtypes() {
  els.dialogueSubtypeList.innerHTML = "";
  const type = activeDialogueType();
  const subtypes = normalizedSubtypes(type);
  if (!subtypes.length) return;

  for (const subtype of subtypes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dialogue-subtype-btn${subtype.id === state.activeDialogueSubtypeId ? " active" : ""}`;
    button.title = subtype.summary || subtype.protocol || subtype.name;
    button.textContent = subtype.name;
    button.addEventListener("click", () => {
      if (subtype.id === state.activeDialogueSubtypeId) {
        if (activePeriodOutputMode()) applyChatPackSelection(`已恢复「${subtype.name}」推荐上下文。`);
        return;
      }
      state.activeDialogueSubtypeId = subtype.id;
      localStorage.setItem(dialogueSubtypeKey(type.id), subtype.id);
      renderDialogueSubtypes();
      applyChatPackSelection(`子类型已切换为「${subtype.name}」。`);
    });
    els.dialogueSubtypeList.append(button);
  }
}

function renderEnhancers() {
  els.enhancerList.innerHTML = "";
  const lengthItems = ENHANCERS.filter((enhancer) => enhancer.group === "length");
  const buttonItems = ENHANCERS.filter((enhancer) => enhancer.group !== "length");

  for (const enhancer of buttonItems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dialogue-subtype-btn${state.activeEnhancerIds.has(enhancer.id) ? " active" : ""}`;
    button.title = enhancer.summary || enhancer.protocol || enhancer.name;
    button.textContent = enhancer.name;
    button.addEventListener("click", () => {
      const enhancerWasActive = state.activeEnhancerIds.has(enhancer.id);
      if (state.activeEnhancerIds.has(enhancer.id)) {
        state.activeEnhancerIds.delete(enhancer.id);
      } else {
        clearEnhancerGroup(enhancer);
        state.activeEnhancerIds.add(enhancer.id);
      }
      state.activeEnhancerIds = new Set(normalizeEnhancerIds([...state.activeEnhancerIds]));
      const periodMode = activePeriodOutputMode();
      if (enhancer.id === MUNGER_SOUL_ENHANCER_ID) {
        if (!enhancerWasActive && periodMode) {
          const lengthEnhancer = ENHANCERS.find((item) => item.id === MUNGER_SOUL_PERIOD_LENGTH_ID);
          clearEnhancerGroup(lengthEnhancer);
          state.activeEnhancerIds.add(MUNGER_SOUL_PERIOD_LENGTH_ID);
        } else if (enhancerWasActive) {
          state.activeEnhancerIds.delete(MUNGER_SOUL_PERIOD_LENGTH_ID);
        }
      }
      localStorage.setItem(enhancerKey(), JSON.stringify([...state.activeEnhancerIds]));
      renderEnhancers();
      syncCurrentQuestionDefault(undefined, undefined, {
        force: enhancer.id === MUNGER_SOUL_ENHANCER_ID && !enhancerWasActive
      });
      const message = `增强器已更新：${selectedEnhancers().map((item) => item.name).join("、") || "无"}。`;
      if (enhancer.id === MUNGER_SOUL_ENHANCER_ID && periodMode) {
        applyRecommendedSources();
        applyPeriodContextSelection(periodMode, state.activePeriodValues[periodMode]);
        resetExpandedContextDirs();
        renderSourceChecklist();
        els.metaPrompt.value = assembledPrompt();
        resetGeneratedContext(message);
      } else {
        applyPromptOnlySelection(message);
      }
    });
    els.enhancerList.append(button);
  }

  if (lengthItems.length) {
    const field = document.createElement("label");
    field.className = "enhancer-length-field";
    field.innerHTML = `<span>字数</span>`;

    const select = document.createElement("select");
    select.setAttribute("aria-label", "输出字数");
    select.innerHTML = `<option value="">自然字数</option>${lengthItems
      .map((enhancer) => `<option value="${escapeHtml(enhancer.id)}">${escapeHtml(enhancer.name)}</option>`)
      .join("")}`;
    select.value = activeLengthEnhancer()?.id || "";
    select.addEventListener("change", () => {
      for (const enhancer of lengthItems) state.activeEnhancerIds.delete(enhancer.id);
      if (select.value) state.activeEnhancerIds.add(select.value);
      state.activeEnhancerIds = new Set(normalizeEnhancerIds([...state.activeEnhancerIds]));
      localStorage.setItem(enhancerKey(), JSON.stringify([...state.activeEnhancerIds]));
      renderEnhancers();
      syncCurrentQuestionDefault();
      applyPromptOnlySelection(`增强器已更新：${selectedEnhancers().map((item) => item.name).join("、") || "无"}。`);
    });

    field.append(select);
    els.enhancerList.append(field);
  }
}

function clearEnhancerGroup(enhancer) {
  if (!enhancer.group) return;
  for (const item of ENHANCERS) {
    if (item.group === enhancer.group) state.activeEnhancerIds.delete(item.id);
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

function applyChatPackSelection(message) {
  const type = activeDialogueType();
  const subtype = activeDialogueSubtype();
  els.scenarioEyebrow.textContent = subtype?.needsDomain
    ? `Learning Mode · ${state.selectedDomain || "未发现领域"}`
    : "Learning Mode · Chat Pack";
  els.scenarioTitle.textContent = subtype ? `${type?.name || "大类"} · ${subtype.name}` : type?.name || "Chat Pack";
  els.domainField.hidden = !subtype?.needsDomain;
  els.metaPrompt.value = assembledPrompt();
  syncCurrentQuestionDefault(type, subtype);
  els.insightLog.value = localStorage.getItem(logKey()) || "";
  applyRecommendedSources();
  renderPeriodPicker();
  renderSourceChecklist();
  resetGeneratedContext(message);
}

function applyPromptOnlySelection(message) {
  els.metaPrompt.value = assembledPrompt();
  els.learningStatus.textContent = message;
  renderChatPackPreview();
}

function defaultQuestionText(type, subtype) {
  const periodMode = activePeriodOutputMode();
  if (periodMode && state.activeEnhancerIds.has(MUNGER_SOUL_ENHANCER_ID)) {
    return MUNGER_SOUL_PERIOD_QUESTIONS[periodMode];
  }
  if (shouldUseMungerSoulQuestion(subtype)) return MUNGER_SOUL_QUESTION;
  return subtype?.name || type?.name || "";
}

function shouldFillEmptyCurrentQuestion(subtype) {
  return shouldUseMungerSoulQuestion(subtype) && !els.currentQuestion.value.trim();
}

function shouldUseMungerSoulQuestion(subtype = activeDialogueSubtype()) {
  return subtype?.id === MUNGER_SOUL_SUBTYPE_ID || state.activeEnhancerIds.has(MUNGER_SOUL_ENHANCER_ID);
}

function syncCurrentQuestionDefault(type = activeDialogueType(), subtype = activeDialogueSubtype(), options = {}) {
  if (options.force || !state.currentQuestionTouched || shouldFillEmptyCurrentQuestion(subtype)) {
    els.currentQuestion.value = defaultQuestionText(type, subtype);
  }
}

function activePeriodOutputMode() {
  const subtypeId = activeDialogueSubtype()?.id;
  return Object.keys(PERIOD_OUTPUTS).find((mode) => PERIOD_OUTPUTS[mode].subtypeId === subtypeId) || "";
}

function renderPeriodPicker() {
  const mode = activePeriodOutputMode();
  if (!mode) {
    els.periodPicker.hidden = true;
    return;
  }

  const config = PERIOD_OUTPUTS[mode];
  const options = periodOptions(mode);
  const fallbackValue = options[0]?.value || "";
  const selectedValue = options.some((option) => option.value === state.activePeriodValues[mode])
    ? state.activePeriodValues[mode]
    : fallbackValue;

  state.activePeriodValues[mode] = selectedValue;
  els.periodPicker.hidden = false;
  els.periodPickerLabel.textContent = config.label;
  els.periodSelect.disabled = !options.length;
  els.periodSelect.innerHTML = options.length
    ? options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")
    : `<option value="">${escapeHtml(config.emptyLabel)}</option>`;
  els.periodSelect.value = selectedValue;
  applyPeriodContextSelection(mode, selectedValue);
  resetExpandedContextDirs();
}

function periodOptions(mode) {
  const config = PERIOD_OUTPUTS[mode];
  const options = new Map();
  for (const file of state.customContextFiles) {
    for (const pattern of periodOptionPatterns(config)) {
      const match = file.path.match(pattern.pattern);
      if (!match) continue;
      const value = pattern.valueFromMatch(match);
      options.set(value, { value, label: config.labelFromValue(value) });
    }
  }
  return [...options.values()].sort((a, b) => b.value.localeCompare(a.value, "zh-Hans-CN"));
}

function periodOptionPatterns(config) {
  return [
    { pattern: config.pattern, valueFromMatch: config.valueFromMatch },
    ...(config.optionPatterns || [])
  ];
}

function applyPeriodContextSelection(mode, value) {
  if (!mode || !value) return 0;
  let count = 0;
  for (const file of state.customContextFiles) {
    const strategy = periodContextStrategy(mode, value, file.path);
    if (!strategy) continue;
    state.contextSelections.set(file.path, strategy);
    count += 1;
  }
  return count;
}

function periodContextStrategy(mode, value, filePath) {
  if (mode === "weekly") {
    return filePath === `${PERIOD_OUTPUTS.weekly.prefixFromValue(value)}process-pack.md`
      ? normalizeStrategy(state.contextFileMap.get(filePath)?.defaultStrategy || "normal")
      : "";
  }
  if (mode === "monthly") return monthlyContextStrategy(value, filePath);
  if (mode === "yearly") return yearlyContextStrategy(value, filePath);
  return "";
}

function monthlyContextStrategy(value, filePath) {
  if (!value.match(/^\d{4}-\d{2}$/) || filePath.endsWith("/input.json")) return "";
  return filePath === `04_output/_dist/monthly/${value}/process-pack.md` ? "high" : "";
}

function yearlyContextStrategy(value, filePath) {
  if (!/^\d{4}$/.test(value) || filePath.endsWith("/input.json")) return "";
  const yearlyProcessPackPath = `04_output/_dist/yearly/${value}/process-pack.md`;

  if (state.contextFileMap.has(yearlyProcessPackPath)) {
    return filePath === yearlyProcessPackPath ? "high" : "";
  }

  if (
    filePath.match(new RegExp(`^04_output/monthly/${value}-\\d{2}\\.md$`))
  ) {
    return "high";
  }
  return "";
}

function selectedPeriodLabel(mode) {
  const value = state.activePeriodValues[mode] || "";
  return value ? PERIOD_OUTPUTS[mode].labelFromValue(value) : "";
}

function activeDialogueType() {
  return DIALOGUE_TYPES.find((type) => type.id === state.activeDialogueTypeId) || DIALOGUE_TYPES[0];
}

function activeDialogueSubtype() {
  return normalizedSubtypes(activeDialogueType()).find((subtype) => subtype.id === state.activeDialogueSubtypeId);
}

function ensureActiveDialogueSubtype() {
  const subtypes = normalizedSubtypes(activeDialogueType());
  if (!subtypes.length) {
    state.activeDialogueSubtypeId = "";
    return;
  }
  if (!subtypes.some((subtype) => subtype.id === state.activeDialogueSubtypeId)) {
    state.activeDialogueSubtypeId = subtypes[0].id;
  }
}

function normalizedSubtypes(type) {
  return (type?.subtypes || []).map((subtype, index) => {
    if (typeof subtype === "string") {
      return { id: slugify(subtype) || `subtype-${index}`, name: subtype, protocol: "" };
    }
    return {
      id: subtype.id || slugify(subtype.name) || `subtype-${index}`,
      name: subtype.name || subtype.id || `小类 ${index + 1}`,
      summary: subtype.summary || "",
      needsDomain: Boolean(subtype.needsDomain),
      includeBaseRecommendedSources: subtype.includeBaseRecommendedSources !== false,
      recommendedSources: subtype.recommendedSources || [],
      protocol: subtype.protocol || ""
    };
  });
}

function isEmptyPromptType(type) {
  return Boolean(type?.emptyPrompt || type?.id === "plain-context");
}

function isEmptyPromptSelection(type, subtype) {
  return Boolean(isEmptyPromptType(type) || subtype?.emptyPrompt || subtype?.id === "other-prompts.empty-prompt");
}

function renderPromptTemplate(template) {
  return template.replaceAll("{{domain}}", state.selectedDomain || "当前领域");
}

function logKey() {
  return `${STORAGE_PREFIX}:log:${state.activeDialogueSubtypeId || state.activeDialogueTypeId}:${state.selectedDomain || "global"}`;
}

function dialogueTypeKey() {
  return `${STORAGE_PREFIX}:dialogue-type`;
}

function dialogueSubtypeKey(typeId) {
  return `${STORAGE_PREFIX}:dialogue-subtype:${typeId || "global"}`;
}

function enhancerKey() {
  return `${STORAGE_PREFIX}:enhancers`;
}

function readEnhancerIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(enhancerKey()) || "[]");
    if (!Array.isArray(parsed)) return [];
    return normalizeEnhancerIds(parsed).filter((id) => ENHANCERS.find((enhancer) => enhancer.id === id)?.group !== "length");
  } catch {
    return [];
  }
}

function normalizeEnhancerIds(ids) {
  const byId = new Map(ENHANCERS.map((enhancer) => [enhancer.id, enhancer]));
  const normalized = [];
  for (const id of ids) {
    const enhancer = byId.get(id);
    if (!enhancer) continue;
    if (enhancer.group) {
      for (let index = normalized.length - 1; index >= 0; index -= 1) {
        if (byId.get(normalized[index])?.group === enhancer.group) normalized.splice(index, 1);
      }
    }
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

function applyRecommendedSources() {
  const recommended = recommendedSourcesForSelection()
    .map((sourcePath) => renderPromptTemplate(sourcePath));
  const availableFiles = recommended.length ? state.customContextFiles : state.contextFiles;
  state.contextSelections = new Map();

  for (const file of availableFiles) {
    const matched = recommended.some(
      (sourcePath) => file.path === sourcePath || file.path.startsWith(`${sourcePath}/`)
    );
    state.contextSelections.set(file.path, matched ? normalizeStrategy(file.defaultStrategy) : "none");
  }
  resetExpandedContextDirs();
}

function selectAllContextSources() {
  const files = sourceTreeFiles();
  for (const file of files) state.contextSelections.set(file.path, "normal");
  renderSourceChecklist();
  resetGeneratedContext(`已全选上下文：${files.length} 个文件。`);
}

function invertContextSources() {
  const files = sourceTreeFiles();
  for (const file of files) {
    const current = state.contextSelections.get(file.path) || "none";
    state.contextSelections.set(file.path, current === "none" ? "normal" : "none");
  }
  renderSourceChecklist();
  resetGeneratedContext("已反选当前上下文树。");
}

function recommendedSourcesForSelection() {
  const subtype = activeDialogueSubtype();
  const type = activeDialogueType();
  const includeBase = subtype?.includeBaseRecommendedSources !== false;
  const baseSources = includeBase && type?.id !== "diagram-generate" ? ["01_core/道", "01_core/memory"] : [];
  const configured = subtype?.recommendedSources?.length ? subtype.recommendedSources : type?.recommendedSources || [];
  const recommended = uniqueList([...baseSources, ...configured]);
  const periodMode = activePeriodOutputMode();
  if (!periodMode || !state.activeEnhancerIds.has(MUNGER_SOUL_ENHANCER_ID)) return recommended;

  const excludedSources = new Set([
    `.agents/skills/learn-x-process/resources/${periodMode}-output-rules.md`,
    "04_output/README.md",
    "04_output/usage.md"
  ]);
  return recommended.filter((sourcePath) => !excludedSources.has(sourcePath));
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

function openCustomContextDialog() {
  state.customDraftSelections = new Set(selectedContextFiles().map((file) => file.path));
  els.customContextSearch.value = "";
  renderCustomContextList();
  els.customContextDialog.showModal();
}

function renderCustomContextList() {
  const query = els.customContextSearch.value.trim().toLowerCase();
  const files = filteredCustomContextFiles(query);
  els.customContextList.innerHTML = "";

  for (const file of files) {
    const label = document.createElement("label");
    label.className = "custom-context-item";
    label.title = file.path;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.customDraftSelections.has(file.path);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.customDraftSelections.add(file.path);
      else state.customDraftSelections.delete(file.path);
      renderCustomContextCount();
    });

    const text = document.createElement("span");
    text.innerHTML = `<strong>${escapeHtml(file.title || file.path)}</strong><em>${escapeHtml(file.path)}</em>`;
    label.append(checkbox, text);
    els.customContextList.append(label);
  }

  renderCustomContextCount();
}

function filteredCustomContextFiles(query) {
  if (!query) return state.customContextFiles;
  return state.customContextFiles.filter((file) =>
    `${file.path}\n${file.title || ""}`.toLowerCase().includes(query)
  );
}

function selectAllVisibleCustomContext() {
  for (const file of filteredCustomContextFiles(els.customContextSearch.value.trim().toLowerCase())) {
    state.customDraftSelections.add(file.path);
  }
  renderCustomContextList();
}

function applyCustomContextSelections() {
  state.contextSelections = new Map();
  for (const path of state.customDraftSelections) {
    state.contextSelections.set(path, normalizeStrategy(state.contextFileMap.get(path)?.defaultStrategy || "normal"));
  }
  for (const file of state.customContextFiles) {
    if (!state.contextSelections.has(file.path)) state.contextSelections.set(file.path, "none");
  }
  resetExpandedContextDirs();
  renderSourceChecklist();
  resetGeneratedContext(`已应用自定义上下文：${state.customDraftSelections.size} 个文件。`);
  els.customContextDialog.close();
}

function renderCustomContextCount() {
  els.customContextCount.textContent = `已选 ${state.customDraftSelections.size} 个文件`;
}

function renderSourceChecklist() {
  els.sourceChecklist.innerHTML = "";
  const tree = buildContextTree(sourceTreeFiles());
  for (const node of tree.children) renderContextNode(node, els.sourceChecklist, 0);
  refreshSelectedContextStats();
}

function resetExpandedContextDirs() {
  const expanded = new Set();
  const tree = buildContextTree(sourceTreeFiles());
  collectPartialContextDirs(tree, expanded);
  state.expandedContextDirs = expanded;
}

function collectPartialContextDirs(node, expanded) {
  if (node.type !== "folder") return;
  if (node.path && directoryStrategy(node) === "partial") expanded.add(node.path);
  for (const child of node.children || []) collectPartialContextDirs(child, expanded);
}

function sourceTreeFiles() {
  const selectedCustomFiles = [...state.contextSelections.keys()]
    .filter((filePath) => !state.contextFiles.some((file) => file.path === filePath))
    .map((filePath) => state.contextFileMap.get(filePath))
    .filter(Boolean);
  return [...state.contextFiles, ...selectedCustomFiles].sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function buildContextTree(files) {
  const root = { name: "", path: "", type: "folder", children: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      if (isFile) {
        cursor.children.push({ name: part, path: nodePath, type: "file", file });
        continue;
      }

      let folder = cursor.children.find((child) => child.type === "folder" && child.path === nodePath);
      if (!folder) {
        folder = { name: part, path: nodePath, type: "folder", children: [], files: [] };
        cursor.children.push(folder);
      }
      folder.files.push(file);
      cursor = folder;
    }
  }
  sortContextTree(root);
  return root;
}

function sortContextTree(node) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.path.localeCompare(b.path, "zh-Hans-CN");
  });
  for (const child of node.children) sortContextTree(child);
}

function renderContextNode(node, container, depth) {
  const row = document.createElement("div");
  row.className = `context-row ${node.type}`;
  row.style.setProperty("--depth", String(depth));

  if (node.type === "folder") {
    const expanded = state.expandedContextDirs.has(node.path);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    toggle.textContent = expanded ? "▾" : "▸";
    toggle.title = expanded ? "收起目录" : "展开目录";
    toggle.addEventListener("click", () => {
      if (expanded) state.expandedContextDirs.delete(node.path);
      else state.expandedContextDirs.add(node.path);
      renderSourceChecklist();
    });

    const strategy = directoryStrategy(node);
    const stateButton = makeStrategyButton(strategy, () => {
      const next = strategy === "checked" ? "none" : "normal";
      for (const file of node.files) state.contextSelections.set(file.path, next);
      resetGeneratedContext(`已将 ${node.path}/ 切换为「${strategyLabel(next)}」。`);
      renderSourceChecklist();
    }, "folder");

    const label = document.createElement("button");
    label.type = "button";
    label.className = "context-label";
    label.title = node.path;
    label.innerHTML = `<strong>${escapeHtml(node.name)}/</strong><span>${node.files.length} 个文件</span>`;
    label.addEventListener("click", () => {
      if (expanded) state.expandedContextDirs.delete(node.path);
      else state.expandedContextDirs.add(node.path);
      renderSourceChecklist();
    });

    row.append(toggle, stateButton, label);
    container.append(row);

    if (expanded) {
      for (const child of node.children) renderContextNode(child, container, depth + 1);
    }
    return;
  }

  const previewExpanded = state.expandedContextFilePreviews.has(node.path);
  const previewText = contextFilePreview(node.file);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = previewExpanded ? "▾" : "▸";
  toggle.title = previewExpanded ? "收起预览" : "展开预览";
  toggle.disabled = !previewText;
  toggle.addEventListener("click", () => {
    toggleContextFilePreview(node.path);
  });

  const strategy = state.contextSelections.get(node.path) || "none";
  const stateButton = makeStrategyButton(strategy, () => {
    const next = nextStrategy(strategy);
    state.contextSelections.set(node.path, next);
    resetGeneratedContext(`已将 ${node.path} 切换为「${strategyLabel(next)}」。`);
    renderSourceChecklist();
  });
  const label = document.createElement("button");
  label.type = "button";
  label.className = "context-label";
  label.title = node.path;
  label.innerHTML = `<strong>${escapeHtml(node.name)}</strong><span>${escapeHtml(node.path)} · 约 ${formatNumber(contextFileCharCount(node.file))} 字</span>`;
  label.addEventListener("click", () => {
    if (previewText) toggleContextFilePreview(node.path);
  });
  row.append(toggle, stateButton, label);
  container.append(row);

  if (previewExpanded && previewText) {
    const preview = document.createElement("div");
    preview.className = "context-preview";
    preview.style.setProperty("--depth", String(depth));
    preview.textContent = previewText;
    container.append(preview);
  }
}

function toggleContextFilePreview(filePath) {
  if (state.expandedContextFilePreviews.has(filePath)) state.expandedContextFilePreviews.delete(filePath);
  else state.expandedContextFilePreviews.add(filePath);
  renderSourceChecklist();
}

function contextFileContent(file) {
  return state.contextFileMap.get(file.path)?.content || file.content || file.preview || "";
}

function contextFilePreview(file) {
  return compactPreviewText(contextFileContent(file), 220);
}

function contextFileCharCount(file) {
  const content = contextFileContent(file);
  if (content) return estimateTextStats(content).visibleChars;
  return Math.max(1, Math.round((file.size || 0) / 2));
}

function compactPreviewText(content, maxChars) {
  const text = content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`[\]()~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function directoryStrategy(node) {
  const selectedCount = node.files.filter((file) => (state.contextSelections.get(file.path) || "none") !== "none").length;
  if (selectedCount === 0) return "none";
  if (selectedCount === node.files.length) return "checked";
  return "partial";
}

function makeStrategyButton(strategy, onClick, scope = "file") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `state-toggle ${scope} ${strategy}`;
  button.textContent = strategySymbol(strategy, scope);
  button.title = strategyTooltip(strategy, scope);
  button.addEventListener("click", onClick);
  return button;
}

function nextStrategy(strategy) {
  const order = ["none", "normal", "high"];
  return order[(order.indexOf(strategy) + 1) % order.length] || "none";
}

function strategySymbol(strategy, scope = "file") {
  if (scope === "folder") return { checked: "✓", partial: "−", none: "" }[strategy] || "";
  return { none: "", normal: "✓", high: "↑" }[strategy] || "";
}

function strategyLabel(strategy) {
  return { checked: "全选", partial: "部分选择", none: "不选", normal: "使用", high: "置顶" }[strategy] || "不选";
}

function strategyTooltip(strategy, scope = "file") {
  if (scope === "folder") return `${strategyLabel(strategy)}；点击切换整组选择`;
  return `${strategyLabel(strategy)}；点击切换为下一个状态`;
}

async function generateContext() {
  const selectedFiles = selectedContextFiles();
  if (!selectedFiles.length) {
    els.learningStatus.textContent = "建议选择一个上下文来源。";
    return;
  }

  setProgress(18);
  els.learningStatus.textContent = "正在读取并编排上下文。";

  setProgress(48);
  const filesWithContent = await loadContextContents(selectedFiles);
  setProgress(82);
  const weighted = buildWeightedContext(filesWithContent);
  state.context = weighted;
  refreshSelectedContextStats(filesWithContent);
  setProgress(100);
  els.learningStatus.textContent = `已编排 ${filesWithContent.length} 个文件的上下文。`;
  renderChatPackPreview();
}

function resetGeneratedContext(message) {
  state.context = "";
  refreshSelectedContextStats();
  setProgress(0);
  els.learningStatus.textContent = message;
  renderChatPackPreview();
}

function refreshSelectedContextStats(files = selectedContextFiles()) {
  const fileCount = files.length;
  const totalChars = files.reduce((sum, file) => sum + contextFileCharCount(file), 0);
  const warning = fileCount > 20 ? " · 过多，建议强烈收缩" : fileCount > 10 ? " · 建议 10 个以内" : "";
  const summary = `已选 ${formatNumber(fileCount)} 个文件 · 约 ${formatNumber(totalChars)} 字${warning}`;

  els.contextFileCount.textContent = String(fileCount);
  els.contextSize.textContent = fileCount ? `约 ${formatNumber(totalChars)} 字` : "未生成";
  if (els.selectedContextSummary) {
    els.selectedContextSummary.textContent = summary;
    els.selectedContextSummary.className = fileCount > 20 ? "danger" : fileCount > 10 ? "warn" : "";
  }
}

function setProgress(value) {
  els.progressBar.style.width = `${value}%`;
}

function getCurrentPrompt() {
  return els.metaPrompt.value.trim();
}

function resetPrompt() {
  els.metaPrompt.value = assembledPrompt();
  els.learningStatus.textContent = "装配 Prompt 已刷新。";
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
  const questionReference = buildQuestionReference(question);
  const dialogueType = activeDialogueType();
  const dialogueSubtype = activeDialogueSubtype();
  const enhancers = selectedEnhancers();
  const lengthEnhancer = activeLengthEnhancer(enhancers);
  const prompt = getCurrentPrompt();
  const emptyPrompt = isEmptyPromptSelection(dialogueType, dialogueSubtype);
  const typeSystem = renderTypeSystem(dialogueType, dialogueSubtype, enhancers, emptyPrompt);
  const promptSection = prompt ? `## Assembled Prompt

${prompt}
` : "";
  const answerGoal = emptyPrompt
    ? "直接围绕 Current Question 回答；不额外套用场景提示词，只根据 Current Question、已选增强器和 Context 回答。"
    : "直接围绕 Current Question 回答；大类定目标，子类型定场景，增强器定思考方式，Context 提供材料。";
  const lengthRequirement = renderOutputLengthRequirement(lengthEnhancer);
  const priorityBasis = emptyPrompt
    ? prompt ? "Current Question、Assembled Prompt、High Priority Context" : "Current Question、High Priority Context"
    : "Current Question、Type System、Assembled Prompt、High Priority Context";
  const context = state.context
    ? contextToText(state.context, { questionReference, dialogueType, dialogueSubtype, enhancers, emptyPrompt })
    : "（Context 尚未生成）";
  const finalTaskAnchor = renderFinalTaskAnchor(questionReference, priorityBasis);

  state.chatPack = `# Chat Pack

## Current Question

${questionReference.currentText}

## Type System

${typeSystem}

${promptSection}
## Output Requirements

- 回答目标：${answerGoal}
- 长度：${lengthRequirement}
- 禁止事项：不要编造；不要强行合并冲突材料；不要让背景 Context 覆盖 Current Question。

## Context Priority Map

- High Priority：本次回答优先依据。
- Normal：背景参考。
- Memory 只作为被选中的上下文材料出现，不在此处重复生成 Review 或 Weekly Output。
- Context Note 只解释文件角色和使用边界，不作为新的证据来源。
- 若上下文冲突，优先依据 ${priorityBasis}。

${context}

${finalTaskAnchor}
`;
  return state.chatPack;
}

function renderTypeSystem(type, subtype, enhancers, emptyPrompt) {
  const categoryEnabled = !emptyPrompt && Boolean(type);
  const subtypeEnabled = !emptyPrompt && Boolean(subtype);
  const enhancerEnabled = enhancers.length > 0;
  const modeParts = ["Current Question", "Context"];
  if (categoryEnabled) modeParts.splice(1, 0, "大类 Prompt");
  if (subtypeEnabled) modeParts.splice(2, 0, "子类型 Prompt");
  if (enhancerEnabled) modeParts.push("增强器 Prompt");

  const promptInventory = `- 当前模式：${modeParts.join(" + ")}
- 大类 Prompt：${categoryEnabled ? `已启用（${type.name}）` : "未启用"}
- 子类型 Prompt：${subtypeEnabled ? `已启用（${subtype.name}）` : "未启用"}
- 增强器 Prompt：${enhancerEnabled ? `已启用（${enhancers.map((enhancer) => enhancer.name).join("、")}）` : "未启用"}`;

  if (emptyPrompt) {
    return `${promptInventory}
- 装配说明：不加入大类行为协议或子类型 Prompt；只使用 Current Question、Context 和已选增强器。`;
  }

  return `${promptInventory}

${renderDialogueProtocol(type, subtype, enhancers)}`;
}

function renderDialogueProtocol(type, subtype, enhancers) {
  if (!type) return "（未选择对话类型）";
  return `### 大类行为协议

**适用场景**：${type.useCases || "按当前问题选择对话方式。"}

**AI 行为方向**
${renderList(type.behaviorDirections)}

**输出目标**：${type.outputGoal || "围绕当前问题给出高质量回应。"}

${subtype ? `### 子类型\n\n**${subtype.name}**：${subtype.summary || "按该场景完成任务。"}\n` : ""}

${enhancers.length ? `### 已选增强器\n\n${enhancers.map((enhancer) => `- ${enhancer.name}：${enhancer.summary || ""}`).join("\n")}\n` : ""}

**避免事项**
${renderList(type.avoid)}`;
}

function assembledPrompt() {
  const type = activeDialogueType();
  const subtype = activeDialogueSubtype();
  const enhancers = selectedEnhancers();
  const emptyPrompt = isEmptyPromptSelection(type, subtype);
  return [
    subtype && !emptyPrompt ? `**子类型 Prompt：${subtype.name}**\n\n${demotePromptMarkdownHeadings(subtype.protocol || "")}` : "",
    ...enhancers.map(renderEnhancerPrompt)
  ].filter(Boolean).join("\n\n---\n\n");
}

function renderEnhancerPrompt(enhancer) {
  const note = enhancer.applicationNote ? `**使用说明**：${enhancer.applicationNote}\n\n` : "";
  return `**增强器 Prompt：${enhancer.name}**\n\n${note}${demotePromptMarkdownHeadings(enhancer.protocol || "")}`;
}

function selectedEnhancers() {
  const normalizedIds = new Set(normalizeEnhancerIds([...state.activeEnhancerIds]));
  return ENHANCERS.filter((enhancer) => normalizedIds.has(enhancer.id));
}

function renderList(items) {
  if (!items?.length) return "- 无";
  return items.map((item) => `- ${item}`).join("\n");
}

function activeLengthEnhancer(enhancers = selectedEnhancers()) {
  return enhancers.find((enhancer) => enhancer.group === "length");
}

function renderOutputLengthRequirement(lengthEnhancer) {
  if (!lengthEnhancer) return "按问题需要自然控制。";
  return `以增强器「${lengthEnhancer.name}」为准；如果 Current Question 中出现其它字数要求，视为旧约束，忽略旧字数。`;
}

function selectedContextFiles() {
  return [...state.contextFileMap.values()]
    .map((file) => ({ ...file, strategy: state.contextSelections.get(file.path) || "none" }))
    .filter((file) => file.strategy !== "none");
}

async function loadContextContents(files) {
  return Promise.all(
    files.map(async (file) => {
      if (file.content) return file;
      const loaded = await getJson(`api/file?path=${encodeURIComponent(file.path)}`);
      return { ...file, content: loaded.content || "" };
    })
  );
}

function buildWeightedContext(files) {
  const mode = activeDialogueSubtype()?.id || activeDialogueType()?.id || state.mode;
  const weightedFiles = files
    .map((file) => {
      const userMultiplier = userMultiplierFor(file.strategy);
      const modeMultiplier = file.modeMultipliers?.[mode] ?? 1;
      const finalWeight = (file.baseWeight || 50) * modeMultiplier * userMultiplier;
      return { ...file, mode, userMultiplier, modeMultiplier, finalWeight };
    })
    .sort((a, b) => b.finalWeight - a.finalWeight || a.path.localeCompare(b.path, "zh-Hans-CN"));

  return {
    high: weightedFiles.filter((file) => file.strategy === "high"),
    normal: weightedFiles.filter((file) => file.strategy === "normal")
  };
}

function userMultiplierFor(strategy) {
  if (strategy === "high") return 2;
  return 1;
}

function normalizeStrategy(strategy) {
  return ["high", "normal"].includes(strategy) ? strategy : "normal";
}

function contextToText(context, options = {}) {
  if (typeof context === "string") return context;
  return [
    renderContextAssemblyIntent(context, options),
    renderContextSection("High Priority Context", "High Priority · Full", context.high),
    renderContextSection("Normal Context", "Normal · Full", context.normal)
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderContextSection(title, label, files) {
  if (!files?.length) return "";
  const body = files
    .map((file) => {
      const content = demoteContextMarkdownHeadings((file.content || "").trim());
      return `### [${label}] ${file.path}\n\n${renderContextNote(file)}\n\n${content}`;
    })
    .join("\n\n---\n\n");
  return `## ${title}\n\n${body}`;
}

function renderContextAssemblyIntent(context, options = {}) {
  const highCount = context.high?.length || 0;
  const normalCount = context.normal?.length || 0;
  const questionReference = options.questionReference || buildQuestionReference(els.currentQuestion.value.trim() || "当前问题");
  const typeName = options.emptyPrompt ? "空提示词" : options.dialogueSubtype?.name || options.dialogueType?.name || "当前类型";
  const promptMode = options.emptyPrompt
    ? "本次不加入大类或子类型场景约束；如已选增强器，只按增强器改变思考方式。"
    : `本次按「${typeName}」使用上下文；材料必须服务所选对话目标。`;

  return `## Context Assembly Intent

- 本次上下文装配服务的问题：${questionReference.contextIntentText}
- 使用协议：High Priority 是本次回答优先依据；Normal 只作为背景、补充证据或约束参考。
- 当前分层：High Priority ${highCount} 个文件，Normal ${normalCount} 个文件。
- 文件边界：每个 \`### [High/Normal] path\` 是一个 Context File；其内容到下一个 \`---\` 分隔符或下一个 Context File 为止。
- Context Note：只说明单个文件的角色和使用边界；不补充新事实，不替代文件正文。
- 注意：不要把背景材料当成任务本身；所有上下文都必须回到 Current Question。
- ${promptMode}`;
}

function renderContextNote(file) {
  const title = file.title && file.title !== file.path ? `《${file.title}》` : file.path;
  return `> Context Note：${title}：${contextProfileForFile(file)}`;
}

function contextProfileForFile(file) {
  const path = file.path || "";
  if (path === "README.md") return "Learn-X 总目标、Chat Pack 定位和最小飞轮；用于校准系统初衷，避免把普通问题过度系统化。";
  if (file.layer === "memory" || path.includes("/memory/")) {
    return "用户近期输入、关注点和已沉淀判断；用于理解用户最近在做什么，但不能覆盖当前问题的新证据。";
  }
  if (file.layer === "dao" || path.includes("/道/")) {
    return "道层 why 和价值方向；用于校准长期原则、人生母题和真实优先级，不替代事实核查或执行细节。";
  }
  if (file.layer === "fa" || path.includes("/法/")) {
    return "法层 what 和领域判断框架；用于识别结构、边界、反例和行动抓手，不当作现实证据本身。";
  }
  if (file.layer === "prompt" || path.includes("/02_prompts/")) {
    return "Prompt 和术层模板；用于约束回答方式和复用表达，不作为事实来源或当前问题的替代品。";
  }
  if (path.includes("/app/code/") || path.includes("/app/assets/") || path.includes("/scripts/") || path.includes("/.agents/")) {
    return "器层工具实现、脚本或 Skill；用于理解工程边界和可改位置，不能反过来定义道和法。";
  }
  if (path.startsWith("03_input/")) {
    return "原始输入、行动证据或自我反馈；用于提供事实材料，不直接等同长期结论。";
  }
  if (path.startsWith("04_output/")) {
    return "阶段性输出或候选总结；用于理解最近一轮处理结果，不等同 Memory 或正式长期资产。";
  }
  if (file.layer === "qi") {
    return "器层 tool 和实现环境；用于理解载体、脚本、平台和操作条件，不替代任务目标。";
  }
  if (file.layer === "shu" || file.layer === "read") {
    return "术层 how、素材或行动线索；用于形成步骤、方法和下一步动作，不上升为长期原则。";
  }
  return "补充背景、证据或约束；只提取与 Current Question 直接相关的部分。";
}

function buildQuestionReference(question) {
  const isLong = estimateTextStats(question).visibleChars > 300;
  return {
    text: question,
    isLong,
    currentText: isLong ? "见最后的 Final Task Anchor；长问题全文只在末尾保留。" : question,
    contextIntentText: isLong ? "见最后的 Final Task Anchor；此处不重复长问题全文。" : "见上方 Current Question。",
    finalText: question
  };
}

function renderFinalTaskAnchor(questionReference, priorityBasis) {
  return `## Final Task Anchor

- 最终要回答的问题：${questionReference.finalText}
- 回答时优先遵守：${priorityBasis}。
- 如果上下文不足、过时或互相冲突，请明确说明，不要强行合并。
- 不要被长上下文带偏；所有材料都必须回到 Current Question。`;
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

function demotePromptMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (_match, hashes) => {
    const level = hashes.length + 3;
    return `${"#".repeat(level)} `;
  });
}

function demoteContextMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (_match, hashes) => {
    const level = hashes.length + 3;
    return `${"#".repeat(level)} `;
  });
}

function renderChatPackPreview() {
  const chatPack = buildChatPack();
  renderFramePreview();
  els.chatPackPreview.value = chatPack;
  renderContextBudget(chatPack);
}

function renderFramePreview() {
  const type = activeDialogueType();
  const subtype = activeDialogueSubtype();
  const enhancers = selectedEnhancers();
  const emptyPrompt = isEmptyPromptSelection(type, subtype);
  const selectedFiles = selectedContextFiles();
  const highCount = selectedFiles.filter((file) => file.strategy === "high").length;
  const normalCount = selectedFiles.filter((file) => file.strategy === "normal").length;
  const questionState = els.currentQuestion.value.trim() ? "已填写" : "未填写";

  els.chatPackFramePreview.value = [
    "# Chat Pack 装配框架",
    "1. Current Question",
    `2. 大类行为协议：${emptyPrompt ? "无" : type?.name || "未选择"}`,
    `3. 子类型 Prompt：${emptyPrompt ? "无" : subtype?.name || "未选择"}`,
    `4. 增强器 Prompt：${enhancers.length ? enhancers.map((item) => item.name).join(" + ") : "无"}`,
    "5. Output Requirements",
    `6. Context Priority Map：High ${highCount} / Normal ${normalCount}`,
    "7. High Priority Context",
    "8. Normal Context",
    "9. 末尾任务锚定"
  ].join("\n");

  els.chatPackContextSummary.value = [
    `当前问题：${questionState}`,
    `大类目标：${emptyPrompt ? "空提示词：只装配问题和上下文" : type?.outputGoal || "-"}`,
    `子类型：${emptyPrompt ? "无" : subtype?.summary || subtype?.name || "-"}`,
    `增强器：${enhancers.length ? enhancers.map((item) => item.summary || item.name).join("；") : "无"}`,
    "",
    `上下文文件：${selectedFiles.length}`,
    ...selectedFiles.slice(0, 12).map((file) => `- [${strategyLabel(file.strategy)}] ${file.path}`),
    selectedFiles.length > 12 ? `- ... 另 ${selectedFiles.length - 12} 个文件` : ""
  ].filter(Boolean).join("\n");
}

function renderContextBudget(text) {
  const stats = estimateTextStats(text);
  const budget = CHATPACK_CONFIG.contextBudget || {};
  const recommendedRatio = budget.recommendedRatio || 2 / 3;
  const tokensPerChineseChar = budget.tokensPerChineseChar || 1.8;
  const recommendedChineseChars = budget.recommendedChineseChars || 30000;
  const recommendedSoftTokens = Math.floor(recommendedChineseChars * tokensPerChineseChar);
  const models = budget.models || [];

  els.chatPackMetrics.textContent = `约 ${formatNumber(stats.visibleChars)} 字`;
  renderChatPackWarning();
  els.contextBudgetList.innerHTML = "";

  for (const model of models) {
    const maxTokens = Math.floor(model.contextTokens * recommendedRatio);
    const maxChars = Math.floor(maxTokens / tokensPerChineseChar);
    const recommendedPercent = Math.ceil((stats.estimatedTokens / recommendedSoftTokens) * 100);
    const maxPercent = Math.ceil((stats.estimatedTokens / maxTokens) * 100);
    const overRecommended = stats.estimatedTokens > recommendedSoftTokens;
    const overMax = stats.estimatedTokens > maxTokens;
    const item = document.createElement("div");
    item.className = `budget-pill${overMax ? " over" : overRecommended ? " warn" : ""}`;
    item.title = `单次推荐不超过 ${formatNumber(recommendedChineseChars)} 字；模型 2/3 上限约 ${formatNumber(maxChars)} 字。`;
    item.innerHTML = `
      <span>${escapeHtml(model.label)} · ${overMax ? "超上限" : overRecommended ? "偏长" : "OK"}</span>
      <div class="budget-row">
        <em>推荐 ${formatPercent(recommendedPercent)}</em>
        <i><b style="width: ${Math.min(recommendedPercent, 100)}%"></b></i>
      </div>
      <em>推荐≤${formatCompact(recommendedChineseChars)}字 · 上限≤${formatCompact(maxChars)}字（${formatPercent(maxPercent)}）</em>
    `;
    els.contextBudgetList.append(item);
  }
}

function estimateTextStats(text) {
  const budget = CHATPACK_CONFIG.contextBudget || {};
  const tokensPerChineseChar = budget.tokensPerChineseChar || 1.8;
  const latinCharsPerToken = budget.latinCharsPerToken || 4;
  const compact = text.replace(/\s/g, "");
  const cjkChars = [...compact.matchAll(/[\u3400-\u9fff\uf900-\ufaff]/g)].length;
  const otherChars = Math.max(compact.length - cjkChars, 0);

  return {
    visibleChars: compact.length,
    estimatedTokens: Math.ceil(cjkChars * tokensPerChineseChar + otherChars / latinCharsPerToken)
  };
}

function renderChatPackWarning() {
  const warnings = [];
  if (!els.currentQuestion.value.trim()) {
    warnings.push("当前问题为空，容易让 AI 泛泛审计；建议先写清这次真实问题。");
  }

  els.chatPackWarning.hidden = !warnings.length;
  els.chatPackWarning.textContent = warnings.join(" ");
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatCompact(value) {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  return formatNumber(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(value, 0)}%`;
}

async function copyText(text, message) {
  const target = currentModule() === "learning" ? els.learningStatus : els.status;
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = message;
  } catch {
    target.textContent = `${message.replace("已生成并复制", "已生成")}（浏览器未允许自动复制）`;
  }
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

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

boot().catch((error) => {
  els.status.textContent = error.message;
});
