import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chdir, cwd } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_TOKEN = 'W6NLbDh1YahvZ9sbjIccEirBnae';
const TABLE_ID = 'tblpYzdooGmKzt3o';
const BASE_URL = 'https://bytedance.feishu.cn/base';
const MEMORY_FILE = join(__dirname, 'research-memory.json');

// --- 参数解析 ---
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i]?.replace(/^--/, '');
  if (!key) continue;
  let val = args[++i];
  if (val && val.startsWith('@')) {
    const filePath = val.slice(1);
    if (existsSync(filePath)) val = readFileSync(filePath, 'utf-8');
  }
  flags[key] = val;
}

if (!flags.title || (!flags.content && !flags['content-file'])) {
  console.error('使用: node research-ingest.mjs --title "主题" --content "文档全文" 或 --content-file /path/to/content.md');
  console.error('必填: --title, --content (或 --content-file)');
  console.error('推荐: --source-type, --one-line, --core-insight, --key-concepts, --munger, --raw-source');
  process.exit(1);
}

let content = flags.content;
if (flags['content-file']) {
  content = readFileSync(flags['content-file'], 'utf-8');
}

function execJson(cmd) {
  const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 100 * 1024 * 1024 });
  return JSON.parse(result.trim());
}

// --- 创建飞书文档 ---
function createDoc(title, body) {
  const originalCwd = cwd();
  const tmpDir = mkdtempSync(join(tmpdir(), 'research-doc-'));

  try {
    // lark-cli @file 要求相对路径，需 chdir 到临时目录
    writeFileSync(join(tmpDir, 'content.md'), body, 'utf-8');
    chdir(tmpDir);

    const cmd = [
      'lark-cli docs +create',
      `--title "${title.replace(/"/g, '\\"')}"`,
      `--content @./content.md`,
      '--doc-format markdown',
      '--format json',
    ].join(' ');

    const result = execJson(cmd + ' 2>/dev/null');
    if (!result.ok) throw new Error(`文档创建失败: ${JSON.stringify(result.error).slice(0, 300)}`);

    const docToken = result.data?.document?.document_id || result.data?.document_id;
    if (!docToken) throw new Error(`无法解析文档 ID: ${JSON.stringify(result.data).slice(0, 300)}`);

    const docUrl = `https://bytedance.feishu.cn/docx/${docToken}`;
    return { docToken, docUrl };
  } finally {
    chdir(originalCwd);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// --- 创建 Base 记录 ---
function createRecord(docUrl) {
  const payload = {
    '研究主题': flags.title || '',
    '来源类型': flags['source-type'] || '其他',
    '一句话洞察': flags['one-line'] || '',
    '核心洞察': flags['core-insight'] || '',
    '飞书文档': docUrl,
    '关键概念': flags['key-concepts'] || '',
    '芒格之魂六层': flags['munger'] || '',
    '原始来源': flags['raw-source'] || '',
    '研究日期': Date.now(),
    '状态': '完成',
  };

  const json = JSON.stringify(payload);
  const escaped = json.replace(/'/g, "'\\''");
  const result = execJson(
    `lark-cli base +record-upsert --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --json '${escaped}' --format json 2>/dev/null`
  );
  if (!result.ok) throw new Error(`Base 写入失败: ${JSON.stringify(result.error).slice(0, 300)}`);

  const recordId = result.data?.record?.record_id_list?.[0];
  if (!recordId) throw new Error(`无法解析 record_id: ${JSON.stringify(result.data).slice(0, 300)}`);
  return recordId;
}

// --- 记忆 ---
function updateMemory(entry) {
  let memory = { schema: 'research-run-memory', runs: [] };
  try { memory = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8')); } catch {}
  memory.runs.push({ ...entry, timestamp: new Date().toISOString() });
  if (memory.runs.length > 50) memory.runs = memory.runs.slice(-50);
  writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// --- 主流程 ---
try {
  console.log(`📝 创建飞书文档：${flags.title}...`);
  const { docToken, docUrl } = createDoc(flags.title, content);
  console.log(`✅ 文档已创建: ${docUrl}`);

  console.log('📋 写入研究表...');
  const recordId = createRecord(docUrl);
  console.log(`✅ 记录已创建: ${recordId}`);

  updateMemory({ action: 'created', recordId, docToken, title: flags.title });
  console.log(`\n✅ 研究入库完成：${flags.title}`);
  console.log(`📄 飞书文档: ${docUrl}`);
  console.log(`🔗 Base 记录: ${BASE_URL}/${BASE_TOKEN}?table=${TABLE_ID}&record=${recordId}`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  updateMemory({ action: 'failed', error: err.message, title: flags.title });
  process.exit(1);
}
