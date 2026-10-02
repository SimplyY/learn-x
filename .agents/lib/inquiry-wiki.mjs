import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_PATH = path.resolve(process.cwd(), "00_config/core-question-library.json");
const LEARN_X_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

// ---- Document Compiler 统一发布链（M5 入口切换，2026-10-02）----
// 受管入口的 docx 正文写入不再由脚本直连 lark-cli 全量覆写：质量门禁、幂等、目标锁、
// 完整读回与 unknown 语义由 dc publish（XML 桥）承担。各入口的业务门禁与写后读回
// 继续成立，dc 门禁是额外的；身份契约不变（AI 的 Docx/Wiki 写入固定 bot）。
export const DC_ROOT = "/Users/yuwei/code/document-compiler";

function runDc(args) {
  const result = spawnSync("python3", ["-m", "compiler.cli", ...args], { cwd: DC_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const sanitizeKey = (value) => String(value).replace(/[^\w.-]+/g, "_").slice(0, 80);

export function dcPublishXml({ caller, businessKey, docToken, xml, identity = "bot", confirmation = {}, workDir }) {
  if (!caller || !businessKey || !docToken || !String(xml || "").trim()) throw new Error("dcPublishXml 缺少 caller/businessKey/docToken/xml");
  const dir = workDir || path.join(LEARN_X_ROOT, "04_output/_dist/dc-publishes", sanitizeKey(caller), sanitizeKey(businessKey));
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, "candidate.xml");
  fs.writeFileSync(xmlPath, xml);

  // 渲染产物缺 colgroup 时按 DS 表格条款补确定性列宽（与 Compiler 树渲染同一算法）。
  const tp = runDc(["tableplan", "--xml", xmlPath, "--out", xmlPath]);
  if (tp.status !== 0) throw new Error(`dc tableplan 失败（exit ${tp.status}）：${(tp.stderr || tp.stdout).slice(0, 300)}`);
  const xmlSha = createHash("sha256").update(fs.readFileSync(xmlPath)).digest("hex");

  // 幂等键 = caller+target+operation+business_key：同键同内容 → Compiler 只读核验现结果；
  // 同键异稿会被阻断，修正稿按 .r2/.r3 递增 business_key（与 invest-x A6 同模式），
  // 每次修正都绑定当次运行的人工确认工件。
  const recordPath = path.join(dir, "publish.json");
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(recordPath, "utf8")); } catch { /* 该业务键首次发布 */ }
  const suffix = previous?.xml_sha256 === xmlSha ? Number(previous.business_key_suffix || 0) : Number(previous?.business_key_suffix || 0) + 1;
  const key = suffix > 0 ? `${businessKey}.r${suffix}` : businessKey;
  const packetPath = path.join(dir, "packet.json");
  const packet = { schema: "ContentPacket/v1", job_id: `${caller}-${key}`, caller, business_key: key, operation: "overwrite", target: { doc: docToken }, identity };
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2));

  const fp = runDc(["fingerprint", "--packet", packetPath, "--xml", xmlPath]);
  if (fp.status !== 0) throw new Error(`dc fingerprint 失败（exit ${fp.status}）：${(fp.stderr || fp.stdout).slice(0, 300)}`);
  const fpPayload = JSON.parse(fp.stdout);

  const source = confirmation.source || "session-command";
  const review = {
    status: "PASS",
    author: `${caller}（经${source}=${confirmation.confirmed_by || "用户"}）`,
    release_id: fpPayload.release_id,
    fingerprint: fpPayload.fingerprint,
    xml_sha256: fpPayload.xml_sha256,
    confirmation: {
      source,
      confirmed_by: confirmation.confirmed_by || "用户（会话内明确指令）",
      ...(confirmation.confirmed_at ? { confirmed_at: confirmation.confirmed_at } : {}),
      // 无独立收据工件的指令级入口，绑定本轮已确认候选（tableplan 后 XML）内容哈希。
      sha256: confirmation.sha256 || xmlSha,
      ...(confirmation.run_id ? { run_id: confirmation.run_id } : {}),
    },
  };
  const reviewPath = path.join(dir, "review.json");
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

  const res = runDc(["publish", "--packet", packetPath, "--xml", xmlPath, "--review", reviewPath, "--state-dir", path.join(DC_ROOT, "state"), "--json"]);
  let envelope = null;
  try { envelope = JSON.parse(res.stdout); } catch { /* 非 JSON 输出走 message 兜底 */ }
  const status = res.status === 0 ? String(envelope?.status || "published") : res.status === 3 ? "unknown" : res.status === 1 ? "blocked" : "usage-error";
  fs.writeFileSync(recordPath, JSON.stringify({ business_key: key, business_key_suffix: suffix, fingerprint: fpPayload.fingerprint, xml_sha256: xmlSha, status, updated_at: new Date().toISOString(), envelope: envelope ?? null }, null, 2));
  if (status !== "published") {
    const message = envelope?.report ? JSON.stringify(envelope.report).slice(0, 400) : (res.stderr || res.stdout || "").slice(0, 300);
    throw new Error(`Compiler 发布未完成（status=${status}）：${message}；未知结果只做只读核查（python3 -m compiler.cli recover），不自动重试`);
  }
  return { status, business_key: key, fingerprint: fpPayload.fingerprint, envelope };
}
