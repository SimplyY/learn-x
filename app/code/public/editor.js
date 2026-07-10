import {
  DIALOGUE_TYPES,
  ENHANCERS,
  applyChatPackSelection,
  applyPromptOnlySelection,
  asciiSlugify,
  activeDialogueSubtype,
  ensurePromptProtocols,
  escapeHtml,
  renderDialogueSubtypes,
  renderDialogueTypes,
  renderEnhancers,
  uniquePromptId
} from "./app.js";
import { els, state } from "./runtime.js";

export function renderEditorAvailability() {
  const enabled = Boolean(state.runtime.canEditChatPack);
  els.editPromptCategories.hidden = !enabled;
  els.sortPromptCatalog.hidden = !enabled;
  els.editPromptCatalog.hidden = !enabled;
  if (!enabled) closePromptEditor();
}

export async function openPromptEditor(mode) {
  if (!state.runtime.canEditChatPack) return;
  if (mode === "content") await ensurePromptProtocols();
  state.promptEditorMode = mode;
  state.promptEditorDraft = structuredClone({ dialogueTypes: DIALOGUE_TYPES, enhancers: ENHANCERS });
  state.promptEditorEntityId = mode === "content" ? `subtype:${state.activeDialogueSubtypeId}` : "";
  state.promptEditorPrompt = null;
  state.promptEditorExpandedSourceDirs = new Set();
  els.promptCatalogEditor.hidden = false;
  els.promptSortEditor.hidden = mode !== "sort";
  els.promptCategoryEditor.hidden = mode !== "category";
  els.promptContentEditor.hidden = mode !== "content";
  els.promptEditorTitle.textContent = mode === "sort" ? "调整提示词顺序" : mode === "category" ? "编辑大类" : "编辑提示词";
  els.promptEditorHint.textContent =
    mode === "sort"
      ? "拖动或使用方向按钮调整，保存后写入配置。"
      : mode === "category"
        ? "新增和调整大类；可把子类型移动到另一个大类。"
        : "每次编辑并保存一个对象；切换对象会放弃当前未保存内容。";
  els.promptEditorStatus.textContent = "";
  if (mode === "sort") renderPromptSortEditor();
  else if (mode === "category") renderPromptCategoryEditor();
  else renderPromptContentEditor();
  els.promptCatalogEditor.showModal();
}

export function closePromptEditor() {
  state.promptEditorMode = "";
  state.promptEditorDraft = null;
  state.promptEditorEntityId = "";
  state.promptEditorPrompt = null;
  state.promptEditorExpandedSourceDirs = new Set();
  if (els.promptCategoryEditor) els.promptCategoryEditor.dataset.typeId = "";
  if (els.promptCatalogEditor?.open) els.promptCatalogEditor.close();
  if (els.promptCatalogEditor) els.promptCatalogEditor.hidden = true;
}

export function renderPromptCategoryEditor() {
  const draft = state.promptEditorDraft;
  const selectedTypeId = els.promptCategoryEditor.dataset.typeId || state.activeDialogueTypeId || draft.dialogueTypes[0]?.id;
  const selectedType = draft.dialogueTypes.find((type) => type.id === selectedTypeId) || draft.dialogueTypes[0];
  els.promptCategoryEditor.dataset.typeId = selectedType?.id || "";
  els.promptCategoryEditor.innerHTML = `
    <div class="category-editor-layout">
      <section class="category-editor-nav">
        <div class="category-editor-section-head">
          <h4>大类</h4>
          <button type="button" data-add-type>新增</button>
        </div>
        <div class="editor-sort-list" data-category-list></div>
      </section>
      <section class="category-editor-detail">
        <div class="category-editor-section-head">
          <h4>大类内容</h4>
          <button type="button" class="danger-action" data-delete-type>删除大类</button>
        </div>
        <div class="prompt-entity-fields" data-category-fields></div>
      </section>
      <section class="category-editor-members">
        <div class="category-editor-section-head">
          <h4>子类型归属</h4>
          <button type="button" data-add-subtype>新增子类型</button>
        </div>
        <div class="prompt-entity-fields" data-subtype-ownership></div>
      </section>
    </div>`;
  const list = els.promptCategoryEditor.querySelector("[data-category-list]");
  for (const type of draft.dialogueTypes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = type.id === selectedType?.id ? "editor-category-pill active" : "editor-category-pill";
    button.textContent = type.name || type.id;
    button.addEventListener("click", () => {
      els.promptCategoryEditor.dataset.typeId = type.id;
      renderPromptCategoryEditor();
    });
    list.append(button);
  }
  els.promptCategoryEditor.querySelector("[data-add-type]").addEventListener("click", addPromptCategoryType);
  els.promptCategoryEditor.querySelector("[data-add-subtype]").addEventListener("click", () => addPromptCategorySubtype(selectedType));
  els.promptCategoryEditor.querySelector("[data-delete-type]").addEventListener("click", () => selectedType && deletePromptCategoryType(selectedType));
  if (!selectedType) return;
  renderPromptCategoryFields(selectedType);
  renderSubtypeOwnership(selectedType);
}

export function renderPromptCategoryFields(type) {
  const container = els.promptCategoryEditor.querySelector("[data-category-fields]");
  container.innerHTML = "";
  appendEditorTextField("正式名称", "name", type.name || "", false, false, "", container, () => ({ item: type }));
  appendEditorTextField("用途说明", "useCases", type.useCases || "", true, false, "", container, () => ({ item: type }));
  appendEditorTextField("输出目标", "outputGoal", type.outputGoal || "", true, false, "", container, () => ({ item: type }));
  appendEditorTextField("行为规则，每行一条", "behaviorDirections", (type.behaviorDirections || []).join("\n"), true, true, "", container, () => ({ item: type }));
  appendEditorTextField("避免事项，每行一条", "avoid", (type.avoid || []).join("\n"), true, true, "", container, () => ({ item: type }));
}

export function renderSubtypeOwnership(selectedType) {
  const container = els.promptCategoryEditor.querySelector("[data-subtype-ownership]");
  container.innerHTML = "";
  const allSubtypes = state.promptEditorDraft.dialogueTypes.flatMap((type) =>
    (type.subtypes || []).map((subtype) => ({ type, subtype }))
  );
  for (const { type, subtype } of allSubtypes) {
    const row = document.createElement("div");
    row.className = "editor-field compact with-action";
    row.innerHTML = `<span>${escapeHtml(subtype.name || subtype.id)}</span><select>${state.promptEditorDraft.dialogueTypes
      .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === type.id ? " selected" : ""}>${escapeHtml(item.name || item.id)}</option>`)
      .join("")}</select><button type="button" class="danger-action compact" aria-label="删除 ${escapeHtml(subtype.name || subtype.id)}">删</button>`;
    row.querySelector("select").addEventListener("change", (event) => moveSubtypeToType(subtype, type.id, event.target.value));
    row.querySelector("button").addEventListener("click", () => deletePromptCategorySubtype(type, subtype));
    container.append(row);
  }
}

export function addPromptCategoryType() {
  const name = prompt("新大类名称");
  if (!name?.trim()) return;
  const id = uniquePromptId(asciiSlugify(name) || prompt("请输入英文短标识"));
  if (!id) return;
  state.promptEditorDraft.dialogueTypes.push({
    id,
    name: name.trim(),
    useCases: "",
    behaviorDirections: [],
    outputGoal: "",
    subtypes: [],
    avoid: []
  });
  els.promptCategoryEditor.dataset.typeId = id;
  renderPromptCategoryEditor();
}

export function addPromptCategorySubtype(type) {
  if (!type) return;
  const name = prompt("新子类型名称");
  if (!name?.trim()) return;
  const slug = uniquePromptId(asciiSlugify(name) || prompt("请输入英文短标识"), (type.subtypes || []).map((subtype) => subtype.id.slice(type.id.length + 1)));
  if (!slug) return;
  type.subtypes = type.subtypes || [];
  type.subtypes.push({
    id: `${type.id}.${slug}`,
    name: name.trim(),
    summary: "",
    recommendedSources: []
  });
  renderPromptCategoryEditor();
}

export function deletePromptCategoryType(type) {
  const subtypeCount = type.subtypes?.length || 0;
  const message = subtypeCount
    ? `删除大类「${type.name || type.id}」及其中 ${subtypeCount} 个子类型？Prompt Markdown 文件会保留在磁盘上。`
    : `删除大类「${type.name || type.id}」？`;
  if (!confirm(message)) return;
  const draft = state.promptEditorDraft;
  draft.dialogueTypes = draft.dialogueTypes.filter((item) => item.id !== type.id);
  els.promptCategoryEditor.dataset.typeId = draft.dialogueTypes[0]?.id || "";
  renderPromptCategoryEditor();
}

export function deletePromptCategorySubtype(type, subtype) {
  if (!confirm(`删除子类型「${subtype.name || subtype.id}」？Prompt Markdown 文件会保留在磁盘上。`)) return;
  type.subtypes = (type.subtypes || []).filter((item) => item.id !== subtype.id);
  renderPromptCategoryEditor();
}

export function moveSubtypeToType(subtype, fromTypeId, toTypeId) {
  if (fromTypeId === toTypeId) return;
  const draft = state.promptEditorDraft;
  const fromType = draft.dialogueTypes.find((type) => type.id === fromTypeId);
  const toType = draft.dialogueTypes.find((type) => type.id === toTypeId);
  if (!fromType || !toType) return;
  const index = fromType.subtypes.findIndex((item) => item.id === subtype.id);
  if (index < 0) return;
  const [item] = fromType.subtypes.splice(index, 1);
  const oldId = item.previousId || item.id;
  const slug = uniquePromptId(item.id.split(".").pop(), (toType.subtypes || []).map((existing) => existing.id.split(".").pop()));
  item.previousId = oldId;
  item.id = `${toType.id}.${slug}`;
  toType.subtypes = toType.subtypes || [];
  toType.subtypes.push(item);
  if (oldId === state.activeDialogueSubtypeId) {
    localStorage.setItem(dialogueTypeKey(), toType.id);
    localStorage.setItem(dialogueSubtypeKey(toType.id), item.id);
  }
  els.promptCategoryEditor.dataset.typeId = toType.id;
  renderPromptCategoryEditor();
}

export function renderPromptSortEditor() {
  const draft = state.promptEditorDraft;
  const selectedTypeId = els.promptSortEditor.dataset.typeId || state.activeDialogueTypeId || draft.dialogueTypes[0]?.id;
  const selectedType = draft.dialogueTypes.find((type) => type.id === selectedTypeId) || draft.dialogueTypes[0];
  els.promptSortEditor.dataset.typeId = selectedType?.id || "";
  els.promptSortEditor.innerHTML = `
    <div class="editor-sort-columns">
      <section class="editor-sort-group">
        <h4>大类</h4>
        <div class="editor-sort-list" data-sort-kind="type"></div>
      </section>
      <section class="editor-sort-group">
        <label class="editor-field"><span>子类型所属大类</span><select id="sortSubtypeTypeSelect">${draft.dialogueTypes
          .map((type) => `<option value="${escapeHtml(type.id)}"${type.id === selectedType?.id ? " selected" : ""}>${escapeHtml(type.name)}</option>`)
          .join("")}</select></label>
        <div class="editor-sort-list" data-sort-kind="subtype"></div>
      </section>
      <section class="editor-sort-group">
        <h4>增强器</h4>
        <div class="editor-sort-list" data-sort-kind="enhancer"></div>
      </section>
    </div>`;
  renderSortableRows(els.promptSortEditor.querySelector('[data-sort-kind="type"]'), draft.dialogueTypes, "type");
  renderSortableRows(els.promptSortEditor.querySelector('[data-sort-kind="subtype"]'), selectedType?.subtypes || [], "subtype", selectedType?.id);
  renderSortableRows(els.promptSortEditor.querySelector('[data-sort-kind="enhancer"]'), draft.enhancers, "enhancer");
  els.promptSortEditor.querySelector("#sortSubtypeTypeSelect").addEventListener("change", (event) => {
    els.promptSortEditor.dataset.typeId = event.target.value;
    renderPromptSortEditor();
  });
}

export function renderSortableRows(container, items, kind, typeId = "") {
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "editor-sort-row";
    row.draggable = true;
    row.dataset.index = String(index);
    row.innerHTML = `<span>${escapeHtml(item.name)}</span><div class="editor-row-actions"><button type="button" aria-label="上移 ${escapeHtml(item.name)}"${index === 0 ? " disabled" : ""}>↑</button><button type="button" aria-label="下移 ${escapeHtml(item.name)}"${index === items.length - 1 ? " disabled" : ""}>↓</button></div>`;
    const [up, down] = row.querySelectorAll("button");
    up.addEventListener("click", () => movePromptEditorItem(kind, index, -1, typeId));
    down.addEventListener("click", () => movePromptEditorItem(kind, index, 1, typeId));
    row.addEventListener("dragstart", () => {
      row.classList.add("dragging");
      container.dataset.dragIndex = String(index);
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex = Number(container.dataset.dragIndex);
      if (Number.isInteger(fromIndex) && fromIndex !== index) movePromptEditorItem(kind, fromIndex, index - fromIndex, typeId);
    });
    container.append(row);
  });
}

export function movePromptEditorItem(kind, index, delta, typeId) {
  const draft = state.promptEditorDraft;
  const list =
    kind === "type"
      ? draft.dialogueTypes
      : kind === "enhancer"
        ? draft.enhancers
        : draft.dialogueTypes.find((type) => type.id === typeId)?.subtypes;
  const nextIndex = index + delta;
  if (!list || nextIndex < 0 || nextIndex >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(nextIndex, 0, item);
  renderPromptSortEditor();
}

export function renderPromptContentEditor() {
  const options = [];
  for (const type of state.promptEditorDraft.dialogueTypes) {
    options.push({ value: `type:${type.id}`, label: `大类 · ${type.name}` });
    for (const subtype of type.subtypes || []) options.push({ value: `subtype:${subtype.id}`, label: `子类型 · ${subtype.name}` });
  }
  for (const enhancer of state.promptEditorDraft.enhancers) {
    options.push({ value: `enhancer:${enhancer.id}`, label: `增强器 · ${enhancer.name}` });
  }
  if (!options.some((option) => option.value === state.promptEditorEntityId)) state.promptEditorEntityId = options[0]?.value || "";
  els.promptEntitySelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === state.promptEditorEntityId ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
  renderPromptEntityFields();
}

export function promptEditorEntity() {
  const [kind, id] = state.promptEditorEntityId.split(":");
  if (kind === "type") return { kind, item: state.promptEditorDraft.dialogueTypes.find((type) => type.id === id) };
  if (kind === "subtype") {
    for (const type of state.promptEditorDraft.dialogueTypes) {
      const item = type.subtypes.find((subtype) => subtype.id === id);
      if (item) return { kind, item, type };
    }
  }
  return { kind, item: state.promptEditorDraft.enhancers.find((enhancer) => enhancer.id === id) };
}

export function renderPromptEntityFields() {
  const entity = promptEditorEntity();
  if (!entity.item) return;
  state.promptEditorPrompt = ["subtype", "enhancer"].includes(entity.kind)
    ? { kind: entity.kind, id: entity.item.id, content: entity.item.protocol || "" }
    : null;
  els.promptEntityFields.innerHTML = "";
  appendEditorTextField("正式名称", "name", entity.item.name || "");
  if (entity.kind === "type") {
    appendEditorTextField("用途说明", "useCases", entity.item.useCases || "", true);
    appendEditorTextField("输出目标", "outputGoal", entity.item.outputGoal || "", true);
    appendEditorTextField("行为规则，每行一条", "behaviorDirections", (entity.item.behaviorDirections || []).join("\n"), true, true);
    appendEditorTextField("避免事项，每行一条", "avoid", (entity.item.avoid || []).join("\n"), true, true);
  } else {
    appendEditorTextField("简介", "summary", entity.item.summary || "", true, false, "summary-editor");
    if (entity.kind === "subtype") {
      appendEditorTextField("默认当前问题，为空时使用正式名称", "currentQuestion", entity.item.currentQuestion || "", true, false, "summary-editor");
    }
    if (entity.kind === "enhancer") {
      appendEditorTextField("应用说明", "applicationNote", entity.item.applicationNote || "", true);
    }
    appendEditorTextField("Prompt Markdown", "protocol", entity.item.protocol || "", true, false, "prompt-source-editor");
    if (entity.kind === "subtype") appendRecommendedSourcesEditor(entity.item, entity.type);
  }
}

export function appendEditorTextField(labelText, fieldName, value, multiline = false, lines = false, className = "", container = els.promptEntityFields, entityResolver = promptEditorEntity) {
  const label = document.createElement("label");
  label.className = "editor-field";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  const control = document.createElement(multiline ? "textarea" : "input");
  if (!multiline) control.type = "text";
  control.value = value;
  control.className = className;
  control.addEventListener("input", () => {
    const entity = entityResolver();
    if (fieldName === "protocol") {
      entity.item.protocol = control.value;
      state.promptEditorPrompt.content = control.value;
    } else {
      entity.item[fieldName] = lines ? control.value.split("\n").map((line) => line.trim()).filter(Boolean) : control.value;
    }
  });
  label.append(caption, control);
  container.append(label);
}

export function appendRecommendedSourcesEditor(subtype, type) {
  const section = document.createElement("section");
  section.className = "editor-field";
  section.innerHTML = `<span>推荐上下文</span><div class="recommended-source-checklist source-checklist"></div><small class="recommended-source-count"></small>`;
  const inherited = subtype.includeBaseRecommendedSources !== false && type?.id !== "diagram-generate"
    ? ["01_core/道", "01_core/memory"]
    : [];
  const selected = new Set([...inherited, ...(subtype.recommendedSources || [])]);
  subtype.includeBaseRecommendedSources = false;
  subtype.recommendedSources = [...selected];
  const tree = buildRecommendedSourceTree([...new Set([...recommendedSourceCandidates(), ...selected])]);
  for (const source of selected) {
    const parts = source.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      state.promptEditorExpandedSourceDirs.add(parts.slice(0, index).join("/"));
    }
  }
  const list = section.querySelector(".recommended-source-checklist");
  const renderNode = (node, depth) => {
    const row = document.createElement("div");
    row.className = "recommended-source-option";
    row.style.setProperty("--depth", String(depth));
    const expanded = state.promptEditorExpandedSourceDirs.has(node.path);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = node.children.length ? "tree-toggle" : "tree-toggle spacer";
    toggle.textContent = node.children.length ? (expanded ? "▾" : "▸") : "";
    toggle.addEventListener("click", () => {
      if (expanded) state.promptEditorExpandedSourceDirs.delete(node.path);
      else state.promptEditorExpandedSourceDirs.add(node.path);
      renderPromptEntityFields();
    });
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox"${selected.has(node.path) ? " checked" : ""}><span>${escapeHtml(node.name)}${node.children.length ? "/" : ""}</span>`;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) selected.add(node.path);
      else selected.delete(node.path);
      subtype.recommendedSources = [...selected];
      section.querySelector(".recommended-source-count").textContent = `已选 ${selected.size} 项`;
    });
    row.append(toggle, label);
    list.append(row);
    if (expanded) for (const child of node.children) renderNode(child, depth + 1);
  };
  for (const node of tree.children) renderNode(node, 0);
  section.querySelector(".recommended-source-count").textContent = `已选 ${selected.size} 项`;
  els.promptEntityFields.append(section);
}

export function buildRecommendedSourceTree(paths) {
  const root = { children: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let cursor = root;
    for (const [index, name] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join("/");
      let node = cursor.children.find((item) => item.path === nodePath);
      if (!node) {
        node = { name, path: nodePath, children: [] };
        cursor.children.push(node);
      }
      cursor = node;
    }
  }
  return root;
}

export function recommendedSourceCandidates() {
  const paths = new Set(["README.md"]);
  for (const file of state.customContextFiles) {
    paths.add(file.path);
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) paths.add(parts.slice(0, index).join("/"));
  }
  return [...paths].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export async function savePromptEditor() {
  if (!state.promptEditorDraft || !state.runtime.canEditChatPack) return;
  els.savePromptEditor.disabled = true;
  els.promptEditorStatus.textContent = "正在保存并重建本地页面…";
  try {
    const response = await fetch("api/chatpack/editor", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dialogueTypes: state.promptEditorDraft.dialogueTypes,
        enhancers: state.promptEditorDraft.enhancers,
        editorMode: state.promptEditorMode,
        allowDelete: state.promptEditorMode === "category",
        prompt: state.promptEditorMode === "content" ? state.promptEditorPrompt : null
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败");
    els.promptEditorStatus.textContent = "保存成功，正在刷新。";
    window.location.reload();
  } catch (error) {
    els.promptEditorStatus.textContent = error.message;
    els.savePromptEditor.disabled = false;
  }
}
