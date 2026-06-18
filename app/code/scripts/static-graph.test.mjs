import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergeEditableConfig, prepareChatPackEdits, writePreparedEdits } from "./chatpack-editor.mjs";
import { buildGraphPayload, isPublicPrivatePath } from "./static-graph.mjs";

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
  assert.doesNotMatch(JSON.stringify(publicGraph), /03_input\/|\.agents\/skills\/learn-x-process\/|04_output\/_dist\//);
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
