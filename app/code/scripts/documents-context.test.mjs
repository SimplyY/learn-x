import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDocumentsMarkdown, readContextFile, readDocumentsMarkdown } from "./documents-context.mjs";

test("lists safe Markdown recursively and reads selected files", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-documents-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "project", "notes"), { recursive: true });
  await mkdir(path.join(root, "project", "node_modules"), { recursive: true });
  await writeFile(path.join(root, "project", "notes", "idea.md"), "# Idea\n");
  await writeFile(path.join(root, "project", "token-notes.md"), "secret\n");
  await writeFile(path.join(root, "project", "node_modules", "ignored.md"), "ignored\n");

  const files = await collectDocumentsMarkdown(root);
  assert.deepEqual(files.map((file) => file.path), ["Documents/project/notes/idea.md"]);
  assert.equal(await readDocumentsMarkdown(files[0].path, root), "# Idea\n");
  await assert.rejects(() => readDocumentsMarkdown("Documents/../outside.md", root));
});

test("Core virtual sources contain metadata only and exact paths read fresh truth every time", async () => {
  let calls = 0;
  const readTruth = async (kind) => ({ kind, content: `# ${kind}\nRead ${++calls}`, revision: calls, sourceUrl: "https://example.test/core", sha256: "hash", readAt: "2026-10-03T00:00:00.000Z" });
  const first = await readContextFile("Core/道", { readTruth });
  const second = await readContextFile("Core/道", { readTruth });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.notEqual(first.content, second.content);
  assert.equal(second.sourceUrl, "https://example.test/core");
  assert.equal(second.path, "Core/道");
  assert.equal((await readContextFile("Core/法", { readTruth })).kind, "fa");
  const beforeInvalid = calls;
  await assert.rejects(() => readContextFile("Core/道/extra", { readTruth }), /Invalid Documents path/);
  assert.equal(calls, beforeInvalid);
});

test("Core reader failure and invalid output never fall back to prior content", async () => {
  let calls = 0;
  const readTruth = async (kind) => {
    if (++calls > 1) throw new Error("Core truth documents are not activated as official sources");
    return { kind, content: "# 道\nPrevious content" };
  };
  await readContextFile("Core/道", { readTruth });
  await assert.rejects(() => readContextFile("Core/道", { readTruth }), /not activated/);
  await assert.rejects(() => readContextFile("Core/道", { readTruth: async () => ({ kind: "fa", content: "wrong document" }) }), /invalid content/);
  await assert.rejects(() => readContextFile("Core/法", { readTruth: async () => ({ kind: "fa", content: " " }) }), /invalid content/);
});

test("old Dao/Fa and migration archive are excluded from listing, direct reads and symlink aliases", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "learn-x-truth-exclusions-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const excludedPaths = ["learn-x/01_core/道/history.md", "learn-x/01_core/法/history.md", "core/runtime/migrations/2026-10-core-dao-fa/original/history.md"];
  for (const relative of [...excludedPaths, "project/active.md"]) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "# Historical material\n");
  }
  for (const [index, relative] of excludedPaths.entries()) {
    await symlink(path.join(root, relative), path.join(root, "project", `alias-${index}.md`));
    await assert.rejects(() => readDocumentsMarkdown(`Documents/${relative}`, root), /not an active context/);
    await assert.rejects(() => readDocumentsMarkdown(`Documents/project/alias-${index}.md`, root), /not an active context/);
  }
  await symlink(path.join(root, "core/runtime/migrations/2026-10-core-dao-fa"), path.join(root, "project/archive-alias"));
  await assert.rejects(() => readDocumentsMarkdown("Documents/project/archive-alias/original/history.md", root), /not an active context/);
  assert.deepEqual((await collectDocumentsMarkdown(root)).map((file) => file.path), ["Documents/project/active.md"]);
  assert.equal((await readContextFile("Documents/project/active.md", { root })).content, "# Historical material\n");
});
