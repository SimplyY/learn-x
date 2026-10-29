// 反馈文案（按方案原型）。发往 Learn 群固定走 runner（lark.mjs），身份 --as bot。

export function notifyText({ docUrl }) {
  return [
    "**本周微信读书精读已准备**",
    "",
    `[打开本周精读文档](${docUrl})`,
    "",
    "修改完成后，@机器人 继续。"
  ].join("\n");
}

export function preparedFeedback({ week, docUrl, candidateCount }) {
  return [
    `**${week} 精读文档已准备**`,
    "",
    `[打开本周精读文档](${docUrl})`,
    "",
    `候选划线 ${candidateCount} 条。请在手机上直接编辑：在「我的思考」写下你自己的判断（可含「行动：…」）；认可的 AI 分析候选下写「认可」。`,
    "",
    "修改完成后，@机器人 继续。"
  ].join("\n");
}

export function waitingFeedback({ week }) {
  return `${week} 精读文档已就绪，暂未检测到你的编辑或「继续」口令；保持等待，不写入任何输入文件。`;
}

export function syncedFeedback({ week, appliedCount, bookCount, jingduPath, skippedCount }) {
  const skipNote = skippedCount ? `；跳过 ${skippedCount} 条（无改动/格式噪音）` : "";
  return [
    `**${week} 精读已同步**`,
    "",
    `写入 ${appliedCount} 条（涉及 ${bookCount} 本书）${skipNote}。`,
    `落盘：${jingduPath}`,
    "",
    "只同步了你明确写下的判断与认可；本周其他输入未改动。"
  ].join("\n");
}

export function blockedFeedback({ week, reason, evidence = [] }) {
  const lines = [`**${week} 精读受阻**`, "", reason, ""];
  if (evidence.length) lines.push(...evidence.map((item) => `- ${item}`), "");
  lines.push("已保留现场，未写入任何输入文件；处理后再运行 `run`。");
  return lines.join("\n");
}
