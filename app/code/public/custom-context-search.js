export function searchCustomContext(files, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const folders = new Map();
  const fileNodes = files.map((file) => {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folderPath = parts.slice(0, index).join("/");
      if (!folders.has(folderPath)) folders.set(folderPath, { type: "folder", name: parts[index - 1], path: folderPath, files: [] });
      folders.get(folderPath).files.push(file);
    }
    return { type: "file", name: parts.at(-1), path: file.path, file };
  });

  const matches = [
    ...[...folders.values()].filter((node) => matchesNode(node, query)),
    ...fileNodes.filter((node) => matchesNode(node, query))
  ];
  return matches.sort((left, right) =>
    pathDepth(left.path) - pathDepth(right.path) ||
    matchRank(left, query) - matchRank(right, query) ||
    (left.type === right.type ? 0 : left.type === "folder" ? -1 : 1) ||
    left.path.localeCompare(right.path, "zh-Hans-CN")
  );
}

function matchesNode(node, query) {
  const name = node.type === "file" ? `${node.name}\n${node.file.title || ""}`.toLowerCase() : node.name.toLowerCase();
  const path = node.path.toLowerCase();
  return name.includes(query) || path === query || path.endsWith(`/${query}`);
}

function matchRank(node, query) {
  const name = (node.type === "file" ? node.file.title || node.name : node.name).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

function pathDepth(filePath) {
  return filePath.split("/").filter(Boolean).length;
}
