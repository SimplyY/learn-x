import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────
const MOONBRIDGE_URL = 'http://127.0.0.1:38441/v1/responses';
const MODEL = 'ark-code-latest';
const BASE_TOKEN = 'W6NLbDh1YahvZ9sbjIccEirBnae';
const TABLE_ID = 'tblMGGWdVH4Iq9Og';
const MEMORY_FILE = join(__dirname, 'wisdom-gate-memory.json');

// ─── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--text') flags.text = args[++i];
  else if (args[i] === '--image') flags.image = args[++i];
  else if (args[i] === '--topic') flags.topic = args[++i];
}

if (!flags.text && !flags.image) {
  console.error('使用: node ingest.mjs --text "..." [--image /path/to/img] [--topic "..."]');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function runLarkCLI(...cmdArgs) {
  const cmd = ['lark-cli', 'base', ...cmdArgs];
  return execSync(cmd.join(' '), { encoding: 'utf-8' });
}

async function callMoonBridge(prompt, imagePath = null) {
  const input = [
    {
      role: 'developer',
      content: [
        '你是一个认知资产结构化专家。你需要将一段高质量认知内容提炼成以下字段，输出纯 JSON。',
        '',
        '字段：',
        '- topic: 所属主题（一句话定主题，如「教育陪跑」「AI Agent 架构」）',
        '- essence: 一句话精华（核心认知的一句话总结，10-25 字）',
        '- level: 层级（"道"|"法"|"术"|"器"）',
        '- core_question: 核心问题和使用场景（这个认知解决什么问题、在什么场景下有用，50-150 字）',
        '- original_text: 完整的长篇内容、原始文本（保留原文关键结构和金句）',
        '- timeliness: 智慧时效性（"短期"|"中期"|"长期"|"永恒"）',
        '',
        '输出纯 JSON，不要 Markdown 包裹，不要其他文字。',
      ].join('\n'),
    },
  ];

  let userMsg = prompt;
  if (imagePath && existsSync(imagePath)) {
    const ext = extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const b64 = (await readFile(imagePath)).toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    userMsg = `[图片：${dataUrl}]\n\n${prompt}`;
  }

  input.push({ role: 'user', content: userMsg });

  const body = {
    model: MODEL,
    input,
    temperature: 0.3,
    max_output_tokens: 2048,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(MOONBRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.status !== 'completed') {
        throw new Error(`MoonBridge returned status=${data.status}: ${JSON.stringify(data)}`);
      }
      const content = data.output_text;
      if (!content) throw new Error(`Empty response: ${JSON.stringify(data)}`);

      // Try to extract JSON from the output
      const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      if (attempt < 2) {
        console.error(`MoonBridge attempt ${attempt + 1} failed: ${err.message}. Retrying...`);
        await sleep(2000);
      } else {
        throw new Error(`MoonBridge failed after 3 attempts: ${err.message}`);
      }
    }
  }
}

function deduplicate(topic, essence) {
  try {
    const keywords = [topic?.slice(0, 10), essence?.slice(0, 10)].filter(Boolean);
    if (keywords.length === 0) return null;
    const result = execSync(
      `lark-cli base +record-search --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --keyword "${keywords[0]}" --search-field "所属主题" --search-field "一句话精华" --limit 5 --format json 2>/dev/null`,
      { encoding: 'utf-8' },
    );
    const parsed = JSON.parse(result);
    if (parsed.ok && parsed.data?.total > 0) {
      return parsed.data.items[0].record_id;
    }
  } catch {}
  return null;
}

function createRecord(fields) {
  const json = JSON.stringify({
    '所属主题': fields.topic,
    '一句话精华': fields.essence,
    '层级': fields.level,
    '核心问题和使用场景': fields.core_question,
    '长篇内容、原始内容': fields.original_text,
    '智慧时效性': fields.timeliness,
  });

  const result = runLarkCLI(
    '+record-upsert',
    `--base-token ${BASE_TOKEN}`,
    `--table-id ${TABLE_ID}`,
    `--json '${json}'`,
    '--format json',
  );
  return JSON.parse(result);
}

function uploadAttachment(recordId, imagePath) {
  if (!imagePath || !existsSync(imagePath)) return null;
  const result = runLarkCLI(
    '+record-upload-attachment',
    `--base-token ${BASE_TOKEN}`,
    `--table-id ${TABLE_ID}`,
    `--record-id ${recordId}`,
    '--field-id 图',
    `--file ${imagePath}`,
    '--format json',
  );
  return JSON.parse(result);
}

function updateMemory(entry) {
  let memory = { runs: [] };
  try {
    memory = JSON.parse(
      execSync(`cat "${MEMORY_FILE}"`, { encoding: 'utf-8' })
    );
  } catch {}
  memory.runs.push({ ...entry, timestamp: new Date().toISOString() });
  if (memory.runs.length > 100) memory.runs = memory.runs.slice(-100);
  writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────
const text = flags.text || (flags.image ? '请分析这张图中的认知内容。' : '');
const topicHint = flags.topic ? `（所属主题提示：${flags.topic}）` : '';
const prompt = `请分析以下认知内容${topicHint}：\n\n${text}`;

try {
  console.log('🔍 正在调用 MoonBridge 提取结构化信息...');
  const fields = await callMoonBridge(prompt, flags.image || null);
  console.log(`  主题: ${fields.topic}`);
  console.log(`  精华: ${fields.essence}`);
  console.log(`  层级: ${fields.level} | 时效: ${fields.timeliness}`);

  console.log('🔎 检查重复...');
  const existingId = deduplicate(fields.topic, fields.essence);
  if (existingId) {
    console.log(`⏭️  已存在记录 (${existingId})，跳过写入。`);
    updateMemory({ action: 'skipped', reason: 'duplicate', existingId, fields });
    process.exit(0);
  }

  console.log('📝 写入智慧之门 Base...');
  const result = createRecord(fields);
  if (!result.ok) {
    throw new Error(`Base 写入失败: ${JSON.stringify(result.error)}`);
  }
  const recordId = result.data?.record?.id || result.data?.record_id;
  console.log(`✅ 记录已创建: ${recordId}`);

  if (flags.image && existsSync(flags.image)) {
    console.log('📎 上传附件...');
    const uploadResult = uploadAttachment(recordId, flags.image);
    if (uploadResult?.ok) {
      console.log('✅ 附件上传成功');
    } else {
      console.error(`⚠️  附件上传可能失败: ${JSON.stringify(uploadResult?.error)}`);
    }
  }

  updateMemory({ action: 'created', recordId, fields });
  console.log('\n✅ 智慧之门入库完成');

} catch (err) {
  console.error(`\n❌ ${err.message}`);
  updateMemory({ action: 'failed', error: err.message, text: text?.slice(0, 200) });
  process.exit(1);
}
