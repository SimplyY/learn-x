import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isoWeekRange } from "../../learn-x-process/scripts/collect-weekly-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const weeklyRoot = path.join(repoRoot, "03_input", "weekly");
export const MIN_DAILY_SCREENSHOTS = 2;
export const CONTEXT_RADIUS = 5;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ISSUE_CODES = new Set([
  "missing_chat_name",
  "missing_time",
  "unknown_sender",
  "uncertain_text",
  "incomplete_context",
  "cropped_chat_title",
  "folded_excluded",
  "no_anchor",
  "no_target_week_messages"
]);

export function shanghaiWeekRange(week) {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week)) throw new Error("周格式必须是 YYYY-Www。");
  // ponytail: shared helper is UTC-based; shift its boundaries once here rather than changing every Learn-X caller.
  const range = isoWeekRange(week);
  return {
    start: new Date(range.start.getTime() - SHANGHAI_OFFSET_MS),
    end: new Date(range.end.getTime() - SHANGHAI_OFFSET_MS)
  };
}

function parseTime(value, label) {
  if (typeof value !== "string") throw new Error(`${label} 必须是 ISO 日期或带时区的时间。`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const milliseconds = Date.parse(`${value}T12:00:00+08:00`);
    if (!Number.isFinite(milliseconds) || formatDateOnly(new Date(milliseconds)) !== value) {
      throw new Error(`${label} 不可解析。`);
    }
    return { milliseconds, precision: "date" };
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} 必须是 ISO 日期或带时区的时间。`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} 不可解析。`);
  return { milliseconds, precision: "minute" };
}

function parseCaptureDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("capture_date 必须是 YYYY-MM-DD。");
  }
  const milliseconds = Date.parse(`${value}T12:00:00+08:00`);
  if (!Number.isFinite(milliseconds)) throw new Error("capture_date 不可解析。");
  if (formatDateOnly(new Date(milliseconds)) !== value) throw new Error("capture_date 不是有效日期。");
  return milliseconds;
}

function inRange(milliseconds, { start, end }) {
  return milliseconds >= start.getTime() && milliseconds < end.getTime();
}

function stableJson(value) {
  return JSON.stringify(value);
}

function normalizeIssues(rawIssues) {
  if (rawIssues === undefined) return [];
  if (!Array.isArray(rawIssues)) throw new Error("issues 必须是数组。");
  return [...new Set(rawIssues.map((issue) => {
    const code = typeof issue === "string" ? issue : issue?.code;
    if (!ISSUE_CODES.has(code)) throw new Error(`不支持的识别缺口：${String(code)}。`);
    return code;
  }))].sort();
}

function normalizeMessage(raw, index) {
  if (!raw || typeof raw !== "object") throw new Error(`第 ${index + 1} 条消息不是对象。`);
  const parsedTime = parseTime(raw.time ?? raw.time_iso, `第 ${index + 1} 条消息时间`);
  if (typeof raw.sender !== "string" || !raw.sender.trim() || /^(未知|unknown|对方)$/i.test(raw.sender.trim())) {
    throw new Error(`第 ${index + 1} 条消息缺少可确认的发送者。`);
  }
  if (typeof raw.is_from_me !== "boolean") throw new Error(`第 ${index + 1} 条消息缺少 is_from_me。`);
  const kind = typeof raw.kind === "string" && raw.kind.trim() ? raw.kind.trim().toLowerCase() : "";
  if (!kind) throw new Error(`第 ${index + 1} 条消息缺少消息类型。`);
  const rawText = raw.text == null ? "" : String(raw.text).trim();
  if (kind === "text" && !rawText) throw new Error(`第 ${index + 1} 条消息缺少可确认正文。`);
  const text = rawText || `[${kind}]`;
  return { timeMs: parsedTime.milliseconds, timePrecision: parsedTime.precision, sender: raw.sender.trim(), isFromMe: raw.is_from_me, kind, text, order: index };
}

function normalizeCapture(rawCapture, captureDate, weekRange, index) {
  if (!rawCapture || typeof rawCapture !== "object") throw new Error(`第 ${index + 1} 个截图记录不是对象。`);
  const chatName = typeof rawCapture.chat_name === "string" ? rawCapture.chat_name.trim() : "";
  if (!chatName) throw new Error(`第 ${index + 1} 个截图缺少聊天名称。`);
  const chatType = rawCapture.chat_type;
  if (!["private", "group", "folded"].includes(chatType)) throw new Error(`截图 ${chatName} 的 chat_type 不确定。`);
  if (chatType === "folded") return { skipped: "folded_excluded" };
  if (!Array.isArray(rawCapture.messages)) throw new Error(`截图 ${chatName} 缺少 messages 数组。`);

  const messages = rawCapture.messages
    .map(normalizeMessage)
    .sort((a, b) => a.timeMs - b.timeMs || a.order - b.order);
  let selected;
  let anchorCount = 0;
  if (chatType === "private") {
    selected = messages.filter((message) => inRange(message.timeMs, weekRange));
  } else {
    const anchors = messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .filter(({ message }) => message.isFromMe && inRange(message.timeMs, weekRange));
    anchorCount = anchors.length;
    if (!anchors.length) {
      selected = messages.filter((message) => inRange(message.timeMs, weekRange));
    } else {
      const partialContext = rawCapture.context_complete === false || anchors.some(({ messageIndex }) => (
        messageIndex < CONTEXT_RADIUS || messageIndex + CONTEXT_RADIUS >= messages.length
      ));
      const selectedIndexes = new Set();
      for (const { messageIndex: anchorIndex } of anchors) {
        for (let offset = -CONTEXT_RADIUS; offset <= CONTEXT_RADIUS; offset += 1) {
          const candidate = anchorIndex + offset;
          if (candidate >= 0 && candidate < messages.length) selectedIndexes.add(candidate);
        }
      }
      selected = [...selectedIndexes].sort((a, b) => a - b).map((messageIndex) => messages[messageIndex]);
      const normalizedMessages = selected.map(({ timeMs, timePrecision, sender, isFromMe, kind, text }) => ({
        timeMs, timePrecision, sender: isFromMe ? "我" : sender, isFromMe, kind, text
      }));
      const key = createHash("sha256")
        .update(stableJson({ captureDate, chatName, chatType, messages: normalizedMessages }))
        .digest("hex");
      return {
        captureDate,
        chatName,
        chatType,
        anchorCount,
        messages: normalizedMessages,
        key,
        issueCodes: partialContext ? ["incomplete_context"] : []
      };
    }
  }
  if (!selected.length) return { skipped: "no_target_week_messages" };
  const normalizedMessages = selected.map(({ timeMs, timePrecision, sender, isFromMe, kind, text }) => ({
    timeMs, timePrecision, sender: isFromMe ? "我" : sender, isFromMe, kind, text
  }));
  const key = createHash("sha256")
    .update(stableJson({ captureDate, chatName, chatType, messages: normalizedMessages }))
    .digest("hex");
  return {
    captureDate,
    chatName,
    chatType,
    anchorCount,
    messages: normalizedMessages,
    key,
    issueCodes: chatType === "group" ? ["no_anchor"] : []
  };
}

export function normalizeCaptureInput(raw, { week }) {
  if (!raw || typeof raw !== "object") throw new Error("截图输入必须是 JSON 对象。");
  const weekRange = shanghaiWeekRange(week);
  const captureDateMs = parseCaptureDate(raw.capture_date);
  if (!inRange(captureDateMs, weekRange)) throw new Error("capture_date 不属于目标 Asia/Shanghai ISO 周。");
  if (!Array.isArray(raw.captures)) throw new Error("截图输入缺少 captures 数组。");
  const issueCodes = new Set(normalizeIssues(raw.issues));
  const captures = [];
  const skipped = [];
  for (const [index, rawCapture] of raw.captures.entries()) {
    const capture = normalizeCapture(rawCapture, raw.capture_date, weekRange, index);
    if (capture.skipped) {
      skipped.push({ chatName: rawCapture?.chat_name ?? "", reason: capture.skipped });
      issueCodes.add(capture.skipped);
    } else {
      captures.push(capture);
      for (const issueCode of capture.issueCodes ?? []) issueCodes.add(issueCode);
    }
  }
  return { captureDate: raw.capture_date, captures, skipped, issueCodes: [...issueCodes].sort() };
}

function weekHeader(week, weekRange) {
  return [
    `# WeChat｜${week}`,
    "",
    `- 采集范围：${formatDateOnly(weekRange.start)} 至 ${formatDateOnly(new Date(weekRange.end.getTime() - 1))}（Asia/Shanghai，含首尾日期）`,
    "- 时区：Asia/Shanghai",
    "- 采集方式：手动截图 + 模型视觉",
    "- 覆盖范围：用户选择的重点聊天人工采样，不代表完整遍历微信",
    "- 规则：排除 folded；群聊保留截图中目标周可见消息，有我发言时再保留前后各 5 条可见上下文；私聊仅保留截图可见消息",
    `- 每日最低要求：${MIN_DAILY_SCREENSHOTS} 张不同截图`,
    ""
  ];
}

function validateExistingMarkdown(markdown, week) {
  if (!markdown) return;
  const header = markdown.match(/^# WeChat｜([^\n]+)$/m)?.[1];
  if (header !== week) throw new Error(`旧 WeChat.md 的周次不是 ${week}，拒绝混写。`);
  if (!markdown.includes("- 采集方式：手动截图 + 模型视觉") || !markdown.includes("人工采样")) {
    throw new Error("旧 WeChat.md 不是手动截图格式，拒绝与旧采集源混写。");
  }
}

function normalizeWeekHeader(markdown) {
  return markdown.replace(
    /^- 规则：排除 folded；群聊围绕我发言保留前后各 5 条可见上下文；私聊仅保留截图可见消息$/m,
    "- 规则：排除 folded；群聊保留截图中目标周可见消息，有我发言时再保留前后各 5 条可见上下文；私聊仅保留截图可见消息"
  );
}

function existingKeys(markdown, date) {
  const keys = new Set();
  const pattern = new RegExp(`<!-- wechat-capture date=${date} key=([a-f0-9]{64}) -->`, "g");
  for (const match of markdown.matchAll(pattern)) keys.add(match[1]);
  return keys;
}

function captureMarkdown(capture, weekRange) {
  const type = capture.chatType === "group" ? "群聊" : "私聊";
  const lines = [
    `<!-- wechat-capture date=${capture.captureDate} key=${capture.key} -->`,
    `## 截图｜${escapeHeading(capture.chatName)}｜${capture.captureDate}`,
    `- 类型：${type}`,
    `- 采集声明：${capture.chatType === "private" ? "人工局部采样，非完整历史" : capture.anchorCount ? "围绕我发言的人工可见上下文" : "人工可见局部采样（本截图未发现“我”消息）"}`
  ];
  if (capture.chatType === "group") {
    lines.push(`- 我的锚点消息：${capture.anchorCount} 条`);
    lines.push(!capture.anchorCount
      ? "- 上下文状态：未发现“我”消息；保留截图中目标周可见消息"
      : capture.issueCodes?.includes("incomplete_context")
      ? "- 上下文状态：部分可见；仅保留截图中可见窗口，未补全缺失消息"
      : "- 上下文状态：每个锚点前后各 5 条可见消息");
  }
  lines.push("- 消息：");
  for (const message of capture.messages) {
    const outsideWeek = message.timeMs < weekRange.start.getTime() || message.timeMs >= weekRange.end.getTime();
    const boundary = outsideWeek ? "（跨周上下文）" : "";
    lines.push(`  - ${formatMessageTime(message)}${boundary}${message.isFromMe ? "｜我" : `｜${escapeInline(message.sender)}`}：${escapeInline(message.text)}`);
  }
  lines.push("");
  return lines;
}

function formatMessageTime(message) {
  return message.timePrecision === "date" ? formatDateOnly(new Date(message.timeMs)) : formatDateTime(new Date(message.timeMs));
}

function formatDateOnly(value) {
  return formatDateTime(value).slice(0, 10);
}

function formatDateTime(value) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function escapeHeading(value) {
  return value.replace(/[\r\n#]/g, " ").replace(/<!--/g, "＜!--").trim();
}

function escapeInline(value) {
  return value.replace(/[\r\n]/g, " ").replace(/<!--/g, "＜!--").trim();
}

function upsertDayBlock(markdown, date, accepted, chats, issueCodes) {
  const status = accepted >= MIN_DAILY_SCREENSHOTS ? "达标" : "不足";
  const chatSummary = chats.length ? chats.map(escapeInline).join("、") : "无";
  const statusBlock = [
    `<!-- wechat-day-status date=${date} accepted=${accepted} required=${MIN_DAILY_SCREENSHOTS} -->`,
    `- 当日截图状态（${date}）：${accepted}/${MIN_DAILY_SCREENSHOTS}（${status}）`,
    `- 当日已采集聊天：${chatSummary}`,
    `<!-- wechat-day-issues date=${date} -->`,
    `- 识别缺口：${issueCodes.length ? issueCodes.join("、") : "无"}`,
    ""
  ].join("\n");
  const withoutOld = markdown
    .replace(new RegExp(`<!-- wechat-day-status date=${date} accepted=\\d+ required=\\d+ -->\\n- 当日截图状态[^\\n]*\\n- 当日已采集聊天[^\\n]*\\n?`, "g"), "")
    .replace(new RegExp(`<!-- wechat-day-issues date=${date} -->\\n- 识别缺口[^\\n]*\\n?`, "g"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${withoutOld}${withoutOld ? "\n\n" : ""}${statusBlock}`;
}

export function prepareWechatAppend({ week, existingMarkdown = "", input }) {
  validateExistingMarkdown(existingMarkdown, week);
  const baseExistingMarkdown = normalizeWeekHeader(existingMarkdown);
  const normalized = normalizeCaptureInput(input, { week });
  const knownKeys = existingKeys(baseExistingMarkdown, normalized.captureDate);
  const added = [];
  let duplicateCount = 0;
  for (const capture of normalized.captures) {
    if (knownKeys.has(capture.key)) duplicateCount += 1;
    else {
      knownKeys.add(capture.key);
      added.push(capture);
    }
  }
  if (!baseExistingMarkdown && added.length === 0) {
    return {
      output: "",
      captureDate: normalized.captureDate,
      acceptedCount: 0,
      addedCount: 0,
      duplicateCount,
      skipped: normalized.skipped,
      issueCodes: normalized.issueCodes,
      remaining: MIN_DAILY_SCREENSHOTS,
      changed: false
    };
  }
  const weekRange = shanghaiWeekRange(week);
  const base = baseExistingMarkdown || weekHeader(week, weekRange).join("\n");
  const appended = added.length ? `${base.trimEnd()}\n\n${added.flatMap((capture) => captureMarkdown(capture, weekRange)).join("\n")}` : base;
  const markdownBeforeStatus = appended.trimEnd();
  const accepted = existingKeys(markdownBeforeStatus, normalized.captureDate).size;
  const chats = [...new Set([...markdownBeforeStatus.matchAll(new RegExp(`<!-- wechat-capture date=${normalized.captureDate} key=[a-f0-9]{64} -->\\n## 截图｜(.+?)｜${normalized.captureDate}`, "g"))].map((match) => match[1]))].sort();
  const issueCodes = [...new Set([...readDayIssueCodes(markdownBeforeStatus, normalized.captureDate), ...normalized.issueCodes])].sort();
  const output = upsertWeekBlock(
    upsertDayBlock(markdownBeforeStatus, normalized.captureDate, accepted, chats, issueCodes),
    week,
    weekRange
  );
  return {
    output,
    captureDate: normalized.captureDate,
    acceptedCount: accepted,
    addedCount: added.length,
    duplicateCount,
    skipped: normalized.skipped,
    issueCodes,
    remaining: Math.max(0, MIN_DAILY_SCREENSHOTS - accepted),
    changed: output !== existingMarkdown
  };
}

function readDayIssueCodes(markdown, date) {
  const match = markdown.match(new RegExp(`<!-- wechat-day-issues date=${date} -->\\n- 识别缺口：([^\\n]*)`));
  if (!match || match[1] === "无") return [];
  return match[1].split("、").filter((code) => ISSUE_CODES.has(code));
}

function captureCounts(markdown) {
  const keysByDate = new Map();
  for (const match of markdown.matchAll(/<!-- wechat-capture date=(\d{4}-\d{2}-\d{2}) key=([a-f0-9]{64}) -->/g)) {
    const keys = keysByDate.get(match[1]) ?? new Set();
    keys.add(match[2]);
    keysByDate.set(match[1], keys);
  }
  return new Map([...keysByDate].map(([date, keys]) => [date, keys.size]));
}

function weekDates(weekRange) {
  return Array.from({ length: 7 }, (_, index) => formatDateOnly(new Date(weekRange.start.getTime() + index * 24 * 60 * 60 * 1000)));
}

function upsertWeekBlock(markdown, week, weekRange) {
  const counts = captureCounts(markdown);
  const dates = weekDates(weekRange);
  const missing = dates.filter((date) => !counts.has(date));
  const insufficient = dates
    .filter((date) => counts.has(date) && counts.get(date) < MIN_DAILY_SCREENSHOTS)
    .map((date) => `${date}（${counts.get(date)}/${MIN_DAILY_SCREENSHOTS}）`);
  const block = [
    `<!-- wechat-week-status week=${week} -->`,
    `- 周度缺口：缺失日期：${missing.length ? missing.join("、") : "无"}；截图不足：${insufficient.length ? insufficient.join("、") : "无"}`,
    ""
  ].join("\n");
  const withoutOld = markdown
    .replace(new RegExp(`<!-- wechat-week-status week=${week} -->\\n- 周度缺口[^\\n]*\\n?`, "g"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${withoutOld}${withoutOld ? "\n\n" : ""}${block}`;
}

export async function appendWechatCaptures({ week, inputPath, outputPath = path.join(weeklyRoot, week, "WeChat.md") }) {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  let existingMarkdown = "";
  try {
    existingMarkdown = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const result = prepareWechatAppend({ week, existingMarkdown, input });
  if (!result.changed || (!existingMarkdown && result.addedCount === 0)) return { ...result, outputPath, written: false };
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, result.output, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return { ...result, outputPath, written: true };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--week") options.week = argv[++index];
    else if (argv[index] === "--input") options.inputPath = path.resolve(argv[++index]);
    else if (argv[index] === "--output") options.outputPath = path.resolve(argv[++index]);
    else throw new Error(`未知参数：${argv[index]}`);
  }
  if (!options.week || !options.inputPath) throw new Error("用法：node append-wechat-captures.mjs --week YYYY-Www --input /private/tmp/wechat-capture.json [--output path]");
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await appendWechatCaptures(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      written: result.written,
      outputPath: result.outputPath,
      captureDate: result.captureDate,
      acceptedCount: result.acceptedCount,
      addedCount: result.addedCount,
      duplicateCount: result.duplicateCount,
      skipped: result.skipped,
      issueCodes: result.issueCodes,
      remaining: result.remaining
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
