import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, chmod, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMemoryCandidates, extractRequiredSections, quarterFromIsoWeek } from "./prepare-weekly-memory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../../..");

export async function prepareWeeklyRangeMemory({ periodId, repoRoot = defaultRepoRoot, reviewEvidence, authorizationEvidence } = {}) {
  if (typeof periodId !== "string") throw new Error("weekly-range-memory-period-required");
  const inputDir = path.join(repoRoot, "03_input/weekly", periodId);
  const outputDir = path.join(repoRoot, "04_output/_dist/weekly", periodId);
  const manifestPath = path.join(inputDir, "_range-manifest.json");
  const processPackPath = path.join(outputDir, "process-pack.md");
  const weeklyPath = path.join(repoRoot, "04_output/weekly", periodId + ".md");
  const approvalPath = path.join(outputDir, "_range-memory-proposal.json");

  const [rangeManifest, processPack, weeklyOutput] = await Promise.all([
    readJson(manifestPath),
    readFile(processPackPath, "utf8"),
    readFile(weeklyPath, "utf8")
  ]);
  const period = validateRange(periodId, rangeManifest.period);
  const firstLine = weeklyOutput.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  if (firstLine !== "# " + periodId + " Weekly Output") throw new Error("weekly-range-memory-output-title-mismatch");
  if (!weeklyOutput.replace(/\s/g, "").includes(coverageLabel(period.start, period.endInclusive))) {
    throw new Error("weekly-range-memory-output-coverage-mismatch");
  }
  const required = extractRequiredSections(weeklyOutput);
  if (required.coreSummary.length !== 1 || required.mungerInsights.length !== 1) {
    throw new Error("weekly-range-memory-required-sections-invalid");
  }
  const weeklyOutputHash = sha256(weeklyOutput);
  if (reviewEvidence?.source !== "official-codex-read-thread"
    || reviewEvidence.periodId !== periodId
    || reviewEvidence.weeklyOutputSha256 !== weeklyOutputHash
    || !reviewEvidence.threadId || !reviewEvidence.userMessageId
    || !/^[a-f0-9]{64}$/.test(reviewEvidence.userMessageSha256 || "")) {
    throw new Error("weekly-range-memory-official-final-review-evidence-required");
  }
  if (authorizationEvidence?.source !== "official-codex-read-thread"
    || authorizationEvidence.periodId !== periodId
    || authorizationEvidence.threadId !== reviewEvidence.threadId
    || authorizationEvidence.authorizesAutomaticCloseout !== true
    || !authorizationEvidence.userMessageId
    || !/^[a-f0-9]{64}$/.test(authorizationEvidence.userMessageSha256 || "")) {
    throw new Error("weekly-range-memory-official-authorization-evidence-required");
  }

  const quarter = quarterFromIsoWeek(period.weeks.at(-1));
  const candidates = extractMemoryCandidates(weeklyOutput);
  if (candidates.coreSummary.length !== 1 || candidates.mungerInsights.length !== 1) {
    throw new Error("weekly-range-memory-candidates-invalid");
  }
  const candidatePath = path.join(outputDir, "memory-candidates.md");
  const proposalPath = path.join(outputDir, "memory-proposed.md");
  const targetPath = path.join(repoRoot, "01_core/memory", quarter + ".memory.md");
  const cardPath = path.join(outputDir, "range-confirmation-card.md");
  const targetHash = await hashOptionalFile(targetPath);
  const scope = buildApprovalScope(periodId, quarter, repoRoot);
  const sourceHashes = {
    rangeManifest: sha256(JSON.stringify(rangeManifest)),
    processPack: sha256(processPack),
    weeklyOutput: weeklyOutputHash,
    officialFinalReview: reviewEvidence.userMessageSha256,
    automaticCloseoutAuthorization: authorizationEvidence.userMessageSha256,
    memoryTarget: targetHash
  };
  const candidatePack = renderCandidatePack({ period, quarter, weeklyPath, processPackPath, candidates, sourceHashes, repoRoot });
  const proposal = renderProposal({ period, quarter, targetPath, candidates, repoRoot });
  const cardBody = renderRangeApprovalCard({ period, quarter, scope, candidates, sourceHashes, targetHash });
  const artifactHashes = { candidates: sha256(candidatePack), proposal: sha256(proposal), cardBody: sha256(cardBody) };
  const payload = {
    schemaVersion: 2,
    periodId,
    weeks: period.weeks,
    coverage: { start: period.start, endInclusive: period.endInclusive },
    quarter,
    paths: {
      weeklyOutput: relative(repoRoot, weeklyPath),
      processPack: relative(repoRoot, processPackPath),
      candidates: relative(repoRoot, candidatePath),
      proposal: relative(repoRoot, proposalPath),
      memoryTarget: relative(repoRoot, targetPath)
    },
    reviewEvidence: {
      source: reviewEvidence.source,
      threadId: reviewEvidence.threadId,
      userMessageId: reviewEvidence.userMessageId,
      userMessageSha256: reviewEvidence.userMessageSha256
    },
    authorizationEvidence: {
      source: authorizationEvidence.source,
      threadId: authorizationEvidence.threadId,
      userMessageId: authorizationEvidence.userMessageId,
      userMessageSha256: authorizationEvidence.userMessageSha256,
      authorizesAutomaticCloseout: authorizationEvidence.authorizesAutomaticCloseout
    },
    scope,
    sourceHashes,
    artifactHashes
  };
  const fingerprint = sha256(JSON.stringify(payload));
  const approval = { ...payload, fingerprint };
  const card = `${cardBody}\n\n## 本次授权记录\n\n- 指纹：\`${fingerprint}\`\n- 用户在本线程已授权本轮按 Skill 完整执行，除极高危操作外无需额外手动授权。\n- 官方用户消息：\`${authorizationEvidence.userMessageId}\`；SHA-256：\`${authorizationEvidence.userMessageSha256}\`\n- 本卡一次覆盖上列 Memory、备份及留存、自动 YWContext 同步尝试、Flomo。\n`;

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const existing = await readOptional(approvalPath);
  if (existing) {
    const saved = JSON.parse(existing);
    if (saved.fingerprint === fingerprint) {
      await verifyArtifacts({ candidatePath, proposalPath, approvalPath, cardPath, candidatePack, proposal, approval, card });
      return result();
    }
    await archiveStaleArtifacts({ outputDir, fingerprint: saved.fingerprint, files: [candidatePath, proposalPath, approvalPath, cardPath] });
  }
  for (const file of [candidatePath, proposalPath, approvalPath, cardPath]) {
    if (await readOptional(file)) throw new Error("weekly-range-memory-artifact-without-manifest: " + path.basename(file));
  }

  await atomicWrite(candidatePath, candidatePack);
  await atomicWrite(proposalPath, proposal);
  await atomicWrite(approvalPath, JSON.stringify(approval, null, 2) + "\n");
  await atomicWrite(cardPath, card);
  await verifyArtifacts({ candidatePath, proposalPath, approvalPath, cardPath, candidatePack, proposal, approval, card });
  return result();

  function result() {
    return {
      periodId,
      quarter,
      candidatePath,
      proposalPath,
      approvalPath,
      cardPath,
      fingerprint,
      counts: {
        coreSummary: candidates.coreSummary.length,
        mungerInsights: candidates.mungerInsights.length,
        checked: candidates.checked.length,
        observations: candidates.observations.length
      },
      memoryTarget: relative(repoRoot, targetPath),
      memoryTargetBaseline: targetHash ? "present" : "missing"
    };
  }
}

export async function applyWeeklyRangeMemory({ periodId, fingerprint, authorizationEvidence, repoRoot = defaultRepoRoot } = {}) {
  const outputDir = path.join(repoRoot, "04_output/_dist/weekly", periodId || "");
  const approvalPath = path.join(outputDir, "_range-memory-proposal.json");
  const candidatePath = path.join(outputDir, "memory-candidates.md");
  const proposalPath = path.join(outputDir, "memory-proposed.md");
  const cardPath = path.join(outputDir, "range-confirmation-card.md");
  const approval = await readJson(approvalPath);
  const { fingerprint: savedFingerprint, ...payload } = approval;
  if (approval.periodId !== periodId || savedFingerprint !== fingerprint || sha256(JSON.stringify(payload)) !== fingerprint) {
    throw new Error("weekly-range-memory-approval-fingerprint-mismatch");
  }
  if (approval.schemaVersion === 1) throw new Error("weekly-range-memory-legacy-scope-read-only");
  if (approval.schemaVersion !== 2 || JSON.stringify(approval.scope) !== JSON.stringify(buildApprovalScope(periodId, approval.quarter))) {
    throw new Error("weekly-range-memory-approval-scope-mismatch");
  }
  if (authorizationEvidence?.source !== "official-codex-read-thread"
    || authorizationEvidence.periodId !== periodId
    || authorizationEvidence.threadId !== approval.authorizationEvidence?.threadId
    || authorizationEvidence.userMessageId !== approval.authorizationEvidence?.userMessageId
    || authorizationEvidence.userMessageSha256 !== approval.authorizationEvidence?.userMessageSha256
    || authorizationEvidence.authorizesAutomaticCloseout !== true) {
    throw new Error("weekly-range-memory-authorization-mismatch");
  }
  const [manifest, processPack, weeklyOutput, candidatePack, proposal, card, targetContent] = await Promise.all([
    readJson(path.join(repoRoot, "03_input/weekly", periodId, "_range-manifest.json")),
    readFile(path.join(repoRoot, "04_output/_dist/weekly", periodId, "process-pack.md"), "utf8"),
    readFile(path.join(repoRoot, "04_output/weekly", periodId + ".md"), "utf8"),
    readFile(candidatePath, "utf8"),
    readFile(proposalPath, "utf8"),
    readFile(cardPath, "utf8"),
    readFile(path.join(repoRoot, approval.paths.memoryTarget), "utf8")
  ]);
  const cardBody = card.split("\n\n## 本次授权记录\n")[0];
  const currentHashes = {
    rangeManifest: sha256(JSON.stringify(manifest)),
    processPack: sha256(processPack),
    weeklyOutput: sha256(weeklyOutput),
    officialFinalReview: approval.reviewEvidence?.userMessageSha256,
    automaticCloseoutAuthorization: approval.authorizationEvidence?.userMessageSha256,
    memoryTarget: sha256(targetContent)
  };
  if (Object.entries(currentHashes).some(([key, value]) => approval.sourceHashes?.[key] !== value)
    || approval.artifactHashes?.candidates !== sha256(candidatePack)
    || approval.artifactHashes?.proposal !== sha256(proposal)
    || approval.artifactHashes?.cardBody !== sha256(cardBody)
    || !card.includes("指纹：`" + fingerprint + "`")) {
    throw new Error("weekly-range-memory-approval-sources-changed");
  }
  const required = extractRequiredSections(weeklyOutput);
  const candidates = extractMemoryCandidates(weeklyOutput);
  if (required.coreSummary.length !== 1 || required.mungerInsights.length !== 1
    || candidates.coreSummary.length !== 1 || candidates.mungerInsights.length !== 1 || candidates.checked.length !== 0) {
    throw new Error("weekly-range-memory-approved-candidates-invalid");
  }
  const rangeHeading = "## " + periodId;
  if (targetContent.split(rangeHeading).length - 1 === 1) {
    const receipt = await readOptional(path.join(outputDir, "_range-memory-write-receipt.json"));
    if (receipt != null) {
      const saved = JSON.parse(receipt);
      if (saved.fingerprint === fingerprint && saved.targetSha256 === sha256(targetContent)) return { status: "already-success", targetSha256: saved.targetSha256, receiptPath: path.join(outputDir, "_range-memory-write-receipt.json") };
    }
    throw new Error("weekly-range-memory-target-already-has-period-without-matching-receipt");
  }
  if (targetContent.includes(rangeHeading) || approval.sourceHashes.memoryTarget !== sha256(targetContent)) {
    throw new Error("weekly-range-memory-target-baseline-changed");
  }

  const mungerHeader = "### 芒格之魂手动洞察候选";
  const lines = targetContent.split("\n");
  const headerIndex = lines.findIndex(line => line.trimEnd() === mungerHeader);
  if (headerIndex < 0) throw new Error("weekly-range-memory-munger-pool-missing");
  const poolEnd = lines.findIndex((line, index) => index > headerIndex && /^##\s/.test(line));
  if (poolEnd < 0 || lines.slice(headerIndex + 1, poolEnd).some(line => line.includes("[" + periodId + "] 洞察："))) {
    throw new Error("weekly-range-memory-munger-pool-conflict");
  }
  const mungerText = candidates.mungerInsights.map(item => "- [" + periodId + "] 洞察：\n  " + indent(item.text)).join("\n\n");
  lines.splice(poolEnd, 0, "", mungerText, "");
  const withMunger = lines.join("\n");
  const memoryText = candidates.coreSummary.map(item => "- " + indent(item.text)).join("\n\n");
  const weeklySection = [rangeHeading, "", "### Memory", "", memoryText || "- 本期无。", "", "### 继续追踪", "", "- 本期未形成已勾选的继续追踪候选。"].join("\n");
  const nextTarget = withMunger.trimEnd() + "\n\n" + weeklySection + "\n";
  const targetPath = path.join(repoRoot, approval.paths.memoryTarget);
  await atomicWrite(targetPath, nextTarget);
  const savedTarget = await readFile(targetPath, "utf8");
  if (savedTarget !== nextTarget || sha256(savedTarget) === approval.sourceHashes.memoryTarget
    || savedTarget.split(rangeHeading).length - 1 !== 1
    || savedTarget.split("[" + periodId + "] 洞察：").length - 1 !== 1) {
    throw new Error("weekly-range-memory-write-readback-mismatch");
  }
  const receiptPath = path.join(outputDir, "_range-memory-write-receipt.json");
  const receiptValue = {
    schemaVersion: 2,
    periodId,
    fingerprint,
    target: approval.paths.memoryTarget,
    baselineSha256: approval.sourceHashes.memoryTarget,
    targetSha256: sha256(savedTarget),
    authorizationMessageId: authorizationEvidence.userMessageId,
    authorizationMessageSha256: authorizationEvidence.userMessageSha256,
    writtenAt: new Date().toISOString(),
    ywcontextSync: {
      status: "pending",
      errorCode: "dynamic_ywcontext_sync_unavailable",
      sourceId: "learn-x-memory-p1-content",
      targetPath: approval.paths.memoryTarget,
      sourceSha256: sha256(savedTarget)
    },
    items: [
      { id: "range-core-summary", section: periodId + "/Memory", sha256: sha256(memoryText) },
      { id: "range-munger-insights", section: "芒格之魂手动洞察候选池", sha256: sha256(mungerText) }
    ]
  };
  const priorReceipt = await readOptional(receiptPath);
  if (priorReceipt != null && JSON.stringify(JSON.parse(priorReceipt)) !== JSON.stringify(receiptValue)) {
    throw new Error("weekly-range-memory-receipt-conflict");
  }
  if (priorReceipt == null) await atomicWrite(receiptPath, JSON.stringify(receiptValue, null, 2) + "\n");
  if (JSON.stringify(await readJson(receiptPath)) !== JSON.stringify(receiptValue)) throw new Error("weekly-range-memory-receipt-readback-mismatch");
  return { status: "written", target: targetPath, targetSha256: sha256(savedTarget), receiptPath, fingerprint };
}

function buildApprovalScope(periodId, quarter) {
  return {
    memory: "01_core/memory/" + quarter + ".memory.md#" + periodId,
    backup: {
      roots: ["01_core/", "03_input/", "04_output/", "05_library/"],
      destination: "Learn-X 专用飞书云盘 / Snapshots 表",
      retention: "保留近 31 天成功快照和每自然年最后一个成功快照；按既有规则清理其他登记快照",
      excludes: "图像、.DS_Store 和凭据类文件"
    },
    ywcontext: {
      sourceId: "learn-x-memory-p1-content",
      level: "P1",
      contentMode: "full",
      trigger: "automatic after verified Memory writeback; no per-record confirmation",
      receiptSchema: "yw-context-publish-receipt/v1",
      unavailableStatus: "pending/unknown with dynamic_ywcontext_sync_unavailable"
    },
    flomo: {
      destination: "Flomo（Ego Lite）",
      memos: ["Learn-X 周记｜" + periodId, "Learn-X 记忆｜" + quarter],
      sources: ["03_input/weekly/" + periodId + "/weekly.md", "01_core/memory/" + quarter + ".memory.md"],
      order: "备份核验成功后执行；逐条搜索、写入、页面读回及状态落盘。"
    }
  };
}

function renderRangeApprovalCard({ period, quarter, scope, candidates, sourceHashes, targetHash }) {
  return [
    "# Learn-X 最终确认卡｜" + period.id,
    "",
    "- 覆盖日期：" + period.start + " 至 " + period.endInclusive + "（" + period.weeks.length + " 个连续 ISO 周）",
    "- Memory 目标：" + scope.memory,
    "- Memory 基线 SHA-256：" + (targetHash || "目标文件当前不存在"),
    "- Weekly Output SHA-256：" + sourceHashes.weeklyOutput,
    "- Process Pack SHA-256：" + sourceHashes.processPack,
    "- 官方线程最终稿确认消息摘要 SHA-256：" + sourceHashes.officialFinalReview,
    "",
    "## 实际拟迁移内容",
    "",
    "### " + period.id + "｜Memory",
    "",
    renderBlocks(candidates.coreSummary),
    "",
    "### " + quarter + "｜芒格之魂手动洞察候选池",
    "",
    renderBlocks(candidates.mungerInsights),
    "",
    "### 已勾选长期候选",
    "",
    renderList(candidates.checked),
    "",
    "## 排除项",
    "",
    "- Weekly Output 的问题、背景与回答保留在报告，不迁移到 Memory。",
    "- 未勾选内容及历史候选观察不迁移。",
    "- 本期没有 Core 导出；本卡不写 Core 道、法或其他 Core 文档。",
    "",
    "## 同一次确认覆盖的收尾范围",
    "",
    "- 备份：" + scope.backup.roots.join("、") + " → " + scope.backup.destination + "；" + scope.backup.retention + "；" + scope.backup.excludes + "。",
    "- YWContext：Memory 写后自动同步 P1 完整内容；动态发布入口或远端读回证据缺失时保留 pending/unknown，不阻塞 Memory 写回。",
    "- Flomo：" + scope.flomo.memos.join("；") + "；来源 " + scope.flomo.sources.join("；") + "；" + scope.flomo.order,
    "",
    "## 确认边界",
    "",
    "本卡一次覆盖列出的 Memory 条目及收尾动作。任何来源哈希变化都会使本卡失效。"
  ].join("\n");
}

async function archiveStaleArtifacts({ outputDir, fingerprint, files }) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint || "")) throw new Error("weekly-range-memory-stale-fingerprint-invalid");
  const archiveDir = path.join(outputDir, "_stale-memory-proposals", fingerprint);
  await mkdir(archiveDir, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const content = await readOptional(file);
    if (content == null) continue;
    const archivedPath = path.join(archiveDir, path.basename(file));
    const archived = await readOptional(archivedPath);
    if (archived != null && archived !== content) throw new Error("weekly-range-memory-stale-archive-conflict");
    if (archived == null) await atomicWrite(archivedPath, content);
    if (await readFile(archivedPath, "utf8") !== content) throw new Error("weekly-range-memory-stale-archive-readback-mismatch");
    await unlink(file);
  }
}

function validateRange(periodId, period) {
  if (!period || period.id !== periodId || !Array.isArray(period.weeks) || period.weeks.length < 2 || period.weeks.length > 4) {
    throw new Error("weekly-range-memory-manifest-invalid");
  }
  const weeks = period.weeks.map(parseWeek);
  for (let index = 1; index < weeks.length; index += 1) {
    const monday = isoMonday(weeks[index - 1].year, weeks[index - 1].week);
    monday.setUTCDate(monday.getUTCDate() + 7);
    if (isoWeekId(monday) !== period.weeks[index]) throw new Error("weekly-range-memory-weeks-not-contiguous");
  }
  const first = weeks[0];
  const last = weeks.at(-1);
  const expectedId = first.year === last.year
    ? first.year + "-W" + pad(first.week) + "-W" + pad(last.week)
    : period.weeks[0] + "-" + period.weeks.at(-1);
  if (expectedId !== periodId || !/^\d{4}-\d{2}-\d{2}$/.test(period.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(period.endInclusive || "")) {
    throw new Error("weekly-range-memory-period-mismatch");
  }
  return period;
}

function parseWeek(value) {
  const match = String(value).match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error("weekly-range-memory-invalid-week: " + value);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const monday = isoMonday(year, week);
  if (isoWeekId(monday) !== value) throw new Error("weekly-range-memory-invalid-week: " + value);
  return { year, week };
}

function coverageLabel(start, endInclusive) {
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(endInclusive + "T00:00:00Z");
  const startText = startDate.getUTCFullYear() + "年" + (startDate.getUTCMonth() + 1) + "月" + startDate.getUTCDate() + "日";
  const endYear = endDate.getUTCFullYear() === startDate.getUTCFullYear() ? "" : endDate.getUTCFullYear() + "年";
  const endText = endYear + (endDate.getUTCMonth() + 1) + "月" + endDate.getUTCDate() + "日";
  return startText + "—" + endText;
}

function isoMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - weekday + 1 + (week - 1) * 7);
  return monday;
}

function isoWeekId(date) {
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - jan4Weekday + 1);
  const week = 1 + Math.floor((date.getTime() - firstMonday.getTime()) / 604_800_000);
  return year + "-W" + pad(week);
}

function renderCandidatePack({ period, quarter, weeklyPath, processPackPath, candidates, sourceHashes, repoRoot }) {
  return [
    "# Learn-X Memory Candidates｜" + period.id,
    "",
    "> 范围候选包，仅供本周期 Memory 审阅；不代表已批准写入。",
    "",
    "## 处理信息",
    "",
    "- 覆盖周期：" + period.id + "（" + period.start + "—" + period.endInclusive + "）",
    "- Weekly Output：" + relative(repoRoot, weeklyPath),
    "- Process Pack：" + relative(repoRoot, processPackPath),
    "- 目标 Memory：01_core/memory/" + quarter + ".memory.md；范围小节 ## " + period.id,
    "- Weekly Output SHA-256：" + sourceHashes.weeklyOutput,
    "- Process Pack SHA-256：" + sourceHashes.processPack,
    "",
    "## 系统确认：全文核心重点纪要",
    "",
    renderBlocks(candidates.coreSummary),
    "",
    "## 系统确认：芒格之魂的洞察",
    "",
    renderBlocks(candidates.mungerInsights),
    "",
    "## 已勾选候选",
    "",
    renderList(candidates.checked),
    "",
    "## 历史候选观察（只读）",
    "",
    renderList(candidates.observations),
    "",
    "## 排除项",
    "",
    "- Weekly Output 的问题、背景和回答不迁移；未勾选内容不写入。",
    "- 本候选包不写正式 Memory，不执行备份、YWContext 或 Flomo。"
  ].join("\n");
}

function renderProposal({ period, quarter, targetPath, candidates, repoRoot }) {
  const munger = candidates.mungerInsights.map((item) => "- [" + period.id + "] 洞察：\n  " + indent(item.text)).join("\n\n");
  const memory = candidates.coreSummary.map((item) => "- " + indent(item.text)).join("\n\n");
  return [
    "# Memory Proposal｜" + period.id,
    "",
    "- 目标：" + relative(repoRoot, targetPath),
    "- 季度：" + quarter,
    "- 来源范围：" + period.id + "（" + period.start + "—" + period.endInclusive + "）",
    "- 本文件是待审阅拟写内容，不是授权或正式 Memory。",
    "",
    "## 候选观察池",
    "",
    "### 芒格之魂手动洞察候选",
    "",
    munger || "- 本期无。",
    "",
    "## " + period.id,
    "",
    "### Memory",
    "",
    memory || "- 本期无。",
    "",
    "### 继续追踪",
    "",
    "- 本期未形成已勾选的继续追踪候选。"
  ].join("\n");
}

function renderBlocks(items) {
  return items.map((item) => "### " + item.section + "\n\n" + item.text).join("\n\n") || "- 暂无。";
}

function renderList(items) {
  return items.map((item) => "- （" + item.section + "）" + item.text).join("\n") || "- 暂无。";
}

function indent(text) {
  return String(text).replace(/\r?\n/g, "\n  ");
}

async function verifyArtifacts({ candidatePath, proposalPath, approvalPath, cardPath, candidatePack, proposal, approval, card }) {
  const [savedCandidates, savedProposal, savedApproval, savedCard] = await Promise.all([
    readFile(candidatePath, "utf8"),
    readFile(proposalPath, "utf8"),
    readFile(approvalPath, "utf8").then(JSON.parse),
    readFile(cardPath, "utf8")
  ]);
  if (savedCandidates !== candidatePack || savedProposal !== proposal
    || JSON.stringify(savedApproval) !== JSON.stringify(approval) || savedCard !== card) {
    throw new Error("weekly-range-memory-readback-mismatch");
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readOptional(file) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function hashOptionalFile(file) {
  const content = await readOptional(file);
  return content == null ? null : sha256(content);
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function atomicWrite(file, content) {
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

if (globalThis.process?.argv?.[1] === fileURLToPath(import.meta.url)) {
  const periodId = globalThis.process.argv.find((argument) => argument.startsWith("--period="))?.slice("--period=".length);
  if (!periodId) throw new Error("usage: node prepare-weekly-range-memory.mjs --period=YYYY-Www-Www");
  console.log(JSON.stringify(await prepareWeeklyRangeMemory({ periodId }), null, 2));
}
