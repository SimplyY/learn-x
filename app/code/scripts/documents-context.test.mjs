import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDocumentsMarkdown, readDocumentsMarkdown } from "./documents-context.mjs";

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
