import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeEditableConfig, prepareChatPackEdits, writePreparedEdits } from "./chatpack-editor.mjs";
import {
  buildChatPackPromptPayload,
  buildChatPackTooltip,
  buildGraphPayload,
  extractPromptTooltipSource,
  isPublicPrivatePath
} from "./static-graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixtureRoot = path.join(repoRoot, "app/code/.test-tmp/chatpack-editor");

test("public graph excludes private workflow material and local graph retains capabilities", async () => {
  const [publicGraph, localGraph] = await Promise.all([
    buildGraphPayload({ includeContent: false, target: "public" }),
    buildGraphPayload({ includeContent: false, target: "local" })
  ]);

  assert.equal(publicGraph.runtime.canEditChatPack, false);
  assert.equal(localGraph.runtime.canEditChatPack, true);
  assert.equal(publicGraph.customContextFiles.some((file) => isPublicPrivatePath(file.path)), false);
  assert.equal(
    publicGraph.customContextFiles.some((file) => /reflective-decision\/(weekly|monthly|yearly)-output\.md$/.test(file.path)),
    false
  );
  assert.equal(localGraph.customContextFiles.some((file) => file.path.startsWith("03_input/")), true);

  const publicSubtypeIds = publicGraph.chatPackConfig.dialogueTypes.flatMap((type) =>
    type.subtypes.map((subtype) => subtype.id)
  );
  assert.equal(publicSubtypeIds.some((id) => id.endsWith("-output")), false);
  const publicPaths = [
    ...publicGraph.files.map((file) => file.path),
    ...publicGraph.customContextFiles.map((file) => file.path),
    ...publicGraph.contextFiles.map((file) => file.path)
  ];
  assert.equal(publicPaths.some((filePath) => isPublicPrivatePath(filePath)), false);
});

test("Chat Pack payload keeps local period prompts out of public builds", async () => {
  const [publicPayload, localPayload] = await Promise.all([
    buildChatPackPromptPayload({ target: "public" }),
    buildChatPackPromptPayload({ target: "local" })
  ]);

  assert.equal(Boolean(localPayload.subtypes["reflective-decision.weekly-output"]), true);
  assert.equal(Boolean(publicPayload.subtypes["reflective-decision.weekly-output"]), false);
  assert.equal(Object.keys(publicPayload.subtypes).length > 0, true);
  assert.equal(Object.keys(publicPayload.enhancers).length > 0, true);
});

test("chat pack tooltips prefer prompt purpose and clean markdown noise", () => {
  const purpose = extractPromptTooltipSource(`# ljg-book - AI Chat Prompt

> Source: .agents/skills/ljg-book/SKILL.md
> Purpose: **以问题为轴拆书**

## 使用方式

把本文件整体复制到 AI Chat。
`);
  assert.equal(purpose, "**以问题为轴拆书**");
  assert.equal(buildChatPackTooltip("拆解一本书", purpose), "拆解一本书 以问题为轴拆书");

  const description = extractPromptTooltipSource(`---
name: sample
description: "Use this skill to deconstruct a book into its core question."
---

# sample

First paragraph.
`);
  assert.equal(description, "Use this skill to deconstruct a book into its core question.");

  const fallback = extractPromptTooltipSource(`# sample

## Heading

第一段正文，带 **加粗**、[链接](https://example.com) 和 \`code\`。
`);
  assert.equal(fallback, "第一段正文，带 加粗 、链接 和 code 。");

  assert.equal(buildChatPackTooltip("x".repeat(260)).length, 200);
});

test("editor preserves immutable fields while updating order and editable content", () => {
  const source = fixtureConfig();
  const payload = {
    dialogueTypes: [
      { ...source.dialogueTypes[1], name: "第二类改名" },
      {
        ...source.dialogueTypes[0],
        subtypes: [
          {
            ...source.dialogueTypes[0].subtypes[0],
            name: "子类型改名",
            currentQuestion: "默认当前问题",
            recommendedSources: ["README.md"]
          }
        ]
      }
    ],
    enhancers: [{ ...source.enhancers[0], name: "增强器改名", group: "tampered" }]
  };
  const merged = mergeEditableConfig(source, payload, fixtureRoot);
  assert.deepEqual(merged.dialogueTypes.map((type) => type.id), ["beta", "alpha"]);
  assert.equal(merged.dialogueTypes[1].subtypes[0].name, "子类型改名");
  assert.equal(merged.dialogueTypes[1].subtypes[0].currentQuestion, "默认当前问题");
  assert.deepEqual(merged.dialogueTypes[1].subtypes[0].recommendedSources, ["README.md"]);
  assert.equal(merged.enhancers[0].name, "增强器改名");
  assert.equal(merged.enhancers[0].group, "length");
});

test("editor writes a validated prompt and rejects repository traversal", async (context) => {
  await rm(fixtureRoot, { recursive: true, force: true });
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(path.join(fixtureRoot, "00_config"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "02_prompts/chatpack/alpha"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), `${JSON.stringify(fixtureConfig(), null, 2)}\n`);
  await writeFile(path.join(fixtureRoot, "README.md"), "# Fixture\n");
  await writeFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "old\n");

  const source = fixtureConfig();
  const payload = {
    dialogueTypes: source.dialogueTypes,
    enhancers: source.enhancers,
    prompt: { kind: "subtype", id: "alpha.one", content: "# Updated prompt" }
  };
  const writes = await prepareChatPackEdits({ repoRoot: fixtureRoot, payload });
  await writePreparedEdits(writes);
  assert.equal(await readFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "utf8"), "# Updated prompt\n");

  const unsafePayload = structuredClone(payload);
  unsafePayload.dialogueTypes[0].subtypes[0].recommendedSources = ["../outside.md"];
  await assert.rejects(() => prepareChatPackEdits({ repoRoot: fixtureRoot, payload: unsafePayload }), /Unsafe recommended/);
});

test("editor adds categories and moves subtype prompts without deleting existing items", async (context) => {
  await rm(fixtureRoot, { recursive: true, force: true });
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(path.join(fixtureRoot, "00_config"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "02_prompts/chatpack/alpha"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), `${JSON.stringify(fixtureConfig(), null, 2)}\n`);
  await writeFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "# Original prompt\n");

  const source = fixtureConfig();
  const payload = {
    dialogueTypes: [
      { ...source.dialogueTypes[0], subtypes: [] },
      source.dialogueTypes[1],
      {
        id: "frequent",
        name: "高频",
        useCases: "常用提示词",
        behaviorDirections: [],
        outputGoal: "",
        avoid: [],
        subtypes: [{ ...source.dialogueTypes[0].subtypes[0], previousId: "alpha.one", id: "frequent.one" }]
      }
    ],
    enhancers: source.enhancers
  };

  const writes = await prepareChatPackEdits({ repoRoot: fixtureRoot, payload });
  await writePreparedEdits(writes);
  const config = JSON.parse(await readFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), "utf8"));
  assert.deepEqual(config.dialogueTypes.map((type) => type.id), ["alpha", "beta", "frequent"]);
  assert.deepEqual(config.dialogueTypes[2].subtypes.map((subtype) => subtype.id), ["frequent.one"]);
  assert.equal(await readFile(path.join(fixtureRoot, "02_prompts/chatpack/frequent/one.md"), "utf8"), "# Original prompt\n");

  const missingExisting = structuredClone(payload);
  missingExisting.dialogueTypes = missingExisting.dialogueTypes.filter((type) => type.id !== "beta");
  await assert.rejects(() => prepareChatPackEdits({ repoRoot: fixtureRoot, payload: missingExisting }), /Invalid dialogue type list|Missing existing dialogue type/);

  await writeFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), `${JSON.stringify(source, null, 2)}\n`);
  const invalidId = structuredClone(payload);
  invalidId.dialogueTypes[2].id = "../bad";
  invalidId.dialogueTypes[2].subtypes[0].id = "../bad.one";
  await assert.rejects(() => prepareChatPackEdits({ repoRoot: fixtureRoot, payload: invalidId }), /Dialogue type id/);
});

test("editor deletes categories only when explicitly allowed and keeps prompt files", async (context) => {
  await rm(fixtureRoot, { recursive: true, force: true });
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(path.join(fixtureRoot, "00_config"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "02_prompts/chatpack/alpha"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), `${JSON.stringify(fixtureConfig(), null, 2)}\n`);
  await writeFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "# Original prompt\n");

  const source = fixtureConfig();
  const deleteSubtypePayload = {
    dialogueTypes: [{ ...source.dialogueTypes[0], subtypes: [] }, source.dialogueTypes[1]],
    enhancers: source.enhancers
  };
  await assert.rejects(() => prepareChatPackEdits({ repoRoot: fixtureRoot, payload: deleteSubtypePayload }), /Missing existing subtype/);

  const subtypeWrites = await prepareChatPackEdits({
    repoRoot: fixtureRoot,
    payload: { ...deleteSubtypePayload, editorMode: "category" }
  });
  await writePreparedEdits(subtypeWrites);
  let config = JSON.parse(await readFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), "utf8"));
  assert.deepEqual(config.dialogueTypes[0].subtypes, []);
  assert.equal(await readFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "utf8"), "# Original prompt\n");

  await writeFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), `${JSON.stringify(source, null, 2)}\n`);
  const typeWrites = await prepareChatPackEdits({
    repoRoot: fixtureRoot,
    payload: { dialogueTypes: [source.dialogueTypes[1]], enhancers: source.enhancers, allowDelete: true }
  });
  await writePreparedEdits(typeWrites);
  config = JSON.parse(await readFile(path.join(fixtureRoot, "00_config/chatpack.config.json"), "utf8"));
  assert.deepEqual(config.dialogueTypes.map((type) => type.id), ["beta"]);
  assert.equal(await readFile(path.join(fixtureRoot, "02_prompts/chatpack/alpha/one.md"), "utf8"), "# Original prompt\n");
});

function fixtureConfig() {
  return {
    contextBudget: {},
    dialogueTypes: [
      {
        id: "alpha",
        name: "第一类",
        subtypes: [{ id: "alpha.one", name: "子类型", summary: "说明", recommendedSources: [] }]
      },
      { id: "beta", name: "第二类", subtypes: [] }
    ],
    enhancers: [{ id: "length-1", name: "长度", group: "length", summary: "说明" }]
  };
}
