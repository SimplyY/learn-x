import assert from "node:assert/strict";
import test from "node:test";
import { searchCustomContext } from "../public/custom-context-search.js";

test("search ranks shallow directories first and keeps them selectable", () => {
  const files = [
    { path: "Documents/research-x/00_system/principles.md", title: "principles" },
    { path: "Documents/research-x/01_books/README.md", title: "README" },
    { path: "Documents/other/research-x-notes.md", title: "research-x notes" }
  ];
  const results = searchCustomContext(files, "research-x");

  assert.deepEqual(results.map((node) => [node.type, node.path]), [
    ["folder", "Documents/research-x"],
    ["file", "Documents/other/research-x-notes.md"]
  ]);
  assert.deepEqual(results[0].files.map((file) => file.path), files.slice(0, 2).map((file) => file.path));
});
