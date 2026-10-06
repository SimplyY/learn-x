export function flomoTags(text) {
  return [...String(text || "").matchAll(/#([^\s#]+)/gu)]
    .map((match) => match[1].replace(/[，,。.;；!！?？）)]+$/u, "").toLowerCase());
}

export function learnXGeneratedReason(text) {
  const value = String(text || "");
  if (flomoTags(value).some((tag) => tag === "learn-x" || tag.startsWith("learn-x/"))) return "learn-x-tag";
  // Recognize complete marker lines and delimited titles, never sentence prefixes.
  const marker = /^(?:Learn-X[ \t]+(?:周记|月记|记忆|同步校验)|(?:【待优化】[ \t]*)?AI[ \t]*基础草稿|飞书周记)(?:[ \t]*[｜|][^\r\n]*)?$/iu;
  const generated = value.split(/\r?\n/).some((line) => {
    const title = line.trim().replace(/^#{1,6}[ \t]+/u, "").replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/u, "$1").trim();
    return marker.test(title);
  });
  return generated ? "generated-memo" : null;
}
