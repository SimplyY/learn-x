import path from "node:path";
import { fileExists, SOURCE_FILES, updateWeeklySourceStatus } from "./lib/source-status.mjs";

const repoRoot = path.resolve(new URL("../../../..", import.meta.url).pathname);
async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of ["week", "source", "status", "file", "count", "summary"]) {
    if (!(name in args)) throw new Error(`缺少参数：--${name}`);
  }
  if (SOURCE_FILES[args.source] !== args.file) throw new Error(`来源文件名与来源不匹配：${args.source}`);
  const weekRoot = path.join(repoRoot, "03_input", "weekly", args.week);
  const document = await updateWeeklySourceStatus({
    weekRoot,
    week: args.week,
    source: args.source,
    status: args.status,
    file: args.file,
    count: Number(args.count),
    summary: args.summary,
    preservedStaleFile: args.status !== "ready" && await fileExists(path.join(weekRoot, args.file))
  });
  console.log(JSON.stringify({ week: document.week, source: args.source, ...document.sources[args.source] }));
}

main().catch((error) => { console.error(error.message); process.exit(1); });

function parseArgs(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i];
    if (!key?.startsWith("--") || !values[i + 1] || values[i + 1].startsWith("--")) {
      throw new Error("参数格式必须为 --name value。");
    }
    result[key.slice(2)] = values[i + 1];
  }
  return result;
}
