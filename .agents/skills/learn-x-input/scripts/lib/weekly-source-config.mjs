import { SOURCE_FILES } from "./source-status.mjs";

// One ordering and policy table for collection reports, Pack rows, and retries.
export const WEEKLY_SOURCE_CONFIG = Object.freeze([
  { id: "daily", file: SOURCE_FILES.daily, type: "日志", source: "飞书日记", group: "important", priority: 0, blocksPack: true, retries: 4, queue: "cli", collector: "input:daily" },
  { id: "flomo", file: SOURCE_FILES.flomo, type: "输入", source: "Flomo", group: "important", priority: 0, blocksPack: true, retries: 4, queue: "browser", collector: "input:flomo" },
  { id: "ai", file: "ai.md", type: "补充", source: "AI 周回顾", group: "important", priority: 0, blocksPack: true, retries: 4, queue: "browser", collector: "ai:weekly" },
  { id: "voice", file: SOURCE_FILES.voice, type: "输入", source: "Voice-X", group: "important", priority: 0, blocksPack: true, retries: 4, queue: "cli", collector: "input:voice" },
  { id: "health", file: SOURCE_FILES.health, type: "日志", source: "Health-X", group: "optional", priority: 0, blocksPack: false, retries: 0, queue: "external", collector: null },
  { id: "core", file: SOURCE_FILES.core, type: "输入", source: "Core V1 确认复盘", group: "optional", priority: 0, blocksPack: false, retries: 2, queue: "cli", collector: "input:core" },
  { id: "weread", file: SOURCE_FILES.weread, type: "输入", source: "微信读书", group: "optional", priority: 1, blocksPack: false, retries: 2, queue: "cli", collector: "input:weread" },
  { id: "calendar", file: SOURCE_FILES.calendar, type: "计划", source: "Time-X 日历", group: "optional", priority: 1, blocksPack: false, retries: 2, queue: "cli", collector: "input:calendar" },
  // The source job also performs an Ego Lite Flomo review import, so it shares the single browser lane.
  { id: "wisdom", file: SOURCE_FILES.wisdom, type: "输入", source: "智慧之门", group: "optional", priority: 1, blocksPack: false, retries: 2, queue: "browser", collector: "input:wisdom", dependsOn: ["flomo", "flomo-review-import"] },
  { id: "jingdu", file: SOURCE_FILES.jingdu, type: "输入", source: "精读", group: "optional", priority: 1, blocksPack: false, retries: 2, queue: "manual", collector: null },
  { id: "coach", file: SOURCE_FILES.coach, type: "行动", source: "AI Coach", group: "optional", priority: 2, blocksPack: false, retries: 2, queue: "cli", collector: "input:coach" },
  { id: "build", file: SOURCE_FILES.build, type: "复盘", source: "Codex / Code X Build", group: "optional", priority: 2, blocksPack: false, retries: 0, queue: "external", collector: null },
  { id: "build-bot", file: SOURCE_FILES["build-bot"], type: "复盘", source: "飞书机器人 Build", group: "optional", priority: 2, blocksPack: false, retries: 0, queue: "external", collector: null },
  { id: "wechat", file: SOURCE_FILES.wechat, type: "输入", source: "微信聊天", group: "optional", priority: 2, blocksPack: false, retries: 0, queue: "manual", collector: null, note: "按需手工采集" }
]);

const byId = new Map(WEEKLY_SOURCE_CONFIG.map((source, index) => [source.id, { ...source, order: index }]));
const byFile = new Map(WEEKLY_SOURCE_CONFIG.map((source, index) => [source.file, { ...source, order: index }]));
const byName = new Map(WEEKLY_SOURCE_CONFIG.map((source, index) => [source.source, { ...source, order: index }]));

export function weeklySourceForId(id) { return byId.get(id); }
export function weeklySourceForFile(file) { return byFile.get(file); }
export function weeklySourceForName(name) { return byName.get(name); }
export function compareWeeklySources(a, b) {
  const left = byFile.get(a.file) || byName.get(a.source);
  const right = byFile.get(b.file) || byName.get(b.source);
  return (left?.order ?? Number.MAX_SAFE_INTEGER) - (right?.order ?? Number.MAX_SAFE_INTEGER)
    || String(a.path || a.source || a.file).localeCompare(String(b.path || b.source || b.file), "zh-Hans-CN");
}
