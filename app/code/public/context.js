export function filterFilesByIncludes(files, includes) {
  if (!includes.length) return files;
  return files.filter((file) =>
    includes.some((includePath) => file.path === includePath || file.path.startsWith(`${includePath}/`))
  );
}

export function buildContext(files, label = "Learn-X") {
  const generatedAt = new Date().toISOString();
  const body = files
    .map((file) => `## ${file.path}\n\n${demoteMarkdownHeadings((file.content || "").trim())}\n`)
    .join("\n---\n\n");
  return `# CONTEXT_MASTER\n\nSource: ${label}\nGenerated from Learn-X at ${generatedAt}.\n\n${body}\n`;
}

export function demoteMarkdownHeadings(content) {
  return content.replace(/^(#{1,6})\s+/gm, (_match, hashes) => `${"#".repeat(Math.min(hashes.length + 2, 6))} `);
}
