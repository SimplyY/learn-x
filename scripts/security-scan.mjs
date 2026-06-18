#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { TextDecoder } from "node:util";

const decoder = new TextDecoder("utf-8", { fatal: false });
const maxBytes = 1024 * 1024;

const sensitivePathPatterns = [
  { name: "env file", pattern: /(^|\/)\.env($|[._-])/i },
  { name: "private key file", pattern: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/i },
  { name: "key or cert file", pattern: /\.(pem|p12|pfx|key|crt|cer)$/i },
  { name: "credential-bearing filename", pattern: /(token|secret|credential|password|cookie|session|wallet)/i },
];

const contentPatterns = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "generic API key assignment", pattern: /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|app[_-]?secret)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}/i },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "Lark app secret", pattern: /\b[A-Za-z0-9]{32,}\b(?=.*\b(?:app[_-]?secret|lark|feishu)\b)/i },
  { name: "JWT token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "cookie or session dump", pattern: /\b(cookie|sessionid|connect\.sid|sid|refresh[_-]?token)\b\s*[:=]\s*['"]?[^'"\n]{20,}/i },
  { name: "Chinese resident ID number", pattern: /(?:身份证|公民身份号码|id\s*card)[^\n]{0,20}\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/ },
  { name: "Chinese mobile phone number with privacy label", pattern: /(?:手机号|手机|电话|联系方式|phone|mobile)[^\n]{0,20}\b1[3-9]\d{9}\b/i },
  { name: "bank card number with privacy label", pattern: /(?:银行卡|卡号|bank\s*card|card\s*number)[^\n]{0,20}\b\d{13,19}\b/i },
  { name: "home address label", pattern: /(?:家庭住址|住址|家庭地址|收货地址|home\s*address|address)\s*[:：]\s*\S.{8,}/i },
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: options.encoding ?? "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function splitNul(buffer) {
  return decoder
    .decode(buffer)
    .split("\0")
    .filter(Boolean);
}

function stagedFiles() {
  return splitNul(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]));
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function stagedContent(file) {
  return git(["show", `:${file}`]);
}

function scanFile(file, readContent) {
  const findings = [];

  for (const rule of sensitivePathPatterns) {
    if (rule.pattern.test(file)) {
      findings.push({ file, rule: rule.name, detail: "sensitive filename" });
    }
  }

  let buffer;
  try {
    buffer = readContent(file);
  } catch {
    return findings;
  }

  if (buffer.length > maxBytes || isBinary(buffer)) {
    return findings;
  }

  const content = decoder.decode(buffer);
  for (const rule of contentPatterns) {
    if (rule.pattern.test(content)) {
      findings.push({ file, rule: rule.name, detail: "sensitive content pattern" });
    }
  }

  return findings;
}

const files = stagedFiles();
const readContent = stagedContent;
const findings = files.flatMap((file) => scanFile(file, readContent));

if (findings.length > 0) {
  console.error("Security scan failed. Do not commit secrets or private personal data.");
  console.error("");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.rule} (${finding.detail})`);
  }
  console.error("");
  console.error("Fix by removing the sensitive value from the staged changes, then stage again.");
  console.error("If this is an intentional private note, keep it out of this repository.");
  process.exit(1);
}

console.log(`Security scan passed (${files.length} staged files checked).`);
