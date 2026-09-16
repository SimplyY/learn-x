import fs from "node:fs";
import path from "node:path";

export const CONFIG_PATH = path.resolve(process.cwd(), "00_config/core-question-library.json");
export const PERIOD_RE = /(?:^|｜)(\d{4})-(Q[1-4]|(?:0[1-9]|1[0-2]))$/;

export function readConfig(file = CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["space_id", "overview_node_token", "research_node_token"]) {
    if (!String(config[key] || "").trim()) throw new Error(`知识库配置缺少 ${key}`);
  }
  return config;
}

export function wikiUrl(nodeToken) { return `https://ywhome.feishu.cn/wiki/${nodeToken}`; }

export function periodFromTitle(title) {
  const match = String(title || "").match(PERIOD_RE);
  return match ? `${match[1]}-${match[2]}` : "";
}

export function sortNodes(nodes) {
  const seen = new Set();
  return [...nodes].sort((a, b) => periodFromTitle(b.title).localeCompare(periodFromTitle(a.title)) || String(b.title || "").localeCompare(String(a.title || ""))).filter((node) => {
    const key = periodFromTitle(node.title) || node.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function renderIndex(title, description, nodes, emptyText) {
  const links = sortNodes(nodes).map((node) => `<p><a href="${wikiUrl(node.node_token || node.token)}">${escapeXml(node.title)}</a></p>`).join("");
  return `<title>${escapeXml(title)}</title><h1>${escapeXml(title)}</h1><p>${escapeXml(description)}</p><h2>文档索引（新 → 旧）</h2>${links || `<p>${escapeXml(emptyText)}</p>`}`;
}

export function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
