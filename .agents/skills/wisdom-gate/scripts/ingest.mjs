import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, copyFileSync, mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename, isAbsolute, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MOONBRIDGE_URL = 'http://127.0.0.1:38441/v1/responses';
const MODEL = 'ark-code-latest';
const BASE_TOKEN = 'W6NLbDh1YahvZ9sbjIccEirBnae';
const TABLE_ID = 'tblMGGWdVH4Iq9Og';
const BASE_URL = 'https://bytedance.feishu.cn/base';
const ATTACHMENT_FIELD_ID = 'fld9P7V5uC';
const MEMORY_FILE = join(__dirname, 'wisdom-gate-memory.json');
const MAX_VISION_BYTES = 800 * 1024; // 800KB for MoonBridge vision

const args = process.argv.slice(2);
const flags = {};
const images = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--text') flags.text = args[++i];
  else if (args[i] === '--image') images.push(args[++i]);
  else if (args[i] === '--topic') flags.topic = args[++i];
  else if (args[i] === '--title') flags.title = args[++i];
  else if (args[i] === '--level') flags.level = args[++i];
}
flags.images = images;

if (!flags.text && images.length === 0) {
  console.error('使用: node ingest.mjs --text "..." [--image /path ...] [--title "..."] [--level "术"]');
  process.exit(1);
}

function execJson(cmd, opts = {}) {
  const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024, ...opts });
  const trimmed = result.trim();
  if (!trimmed) throw new Error('Empty output from command');
  return JSON.parse(trimmed);
}

function prepareVisionImage(absPath, tmpDirs) {
  if (!existsSync(absPath)) return null;
  const stat = statSync(absPath);
  let visionPath = absPath;
  if (stat.size > MAX_VISION_BYTES) {
    const ext = extname(absPath).toLowerCase();
    const canResize = ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
    if (canResize) {
      const outDir = mkdtempSync(join(tmpdir(), 'wg-vis-'));
      tmpDirs.push(outDir);
      const outPath = join(outDir, basename(absPath, ext) + '.jpg');
      try {
        execSync(`sips -Z 1024 "${absPath}" --out "${outPath}" 2>/dev/null`, { stdio: 'pipe' });
        const newSize = statSync(outPath).size;
        if (newSize <= MAX_VISION_BYTES * 2) {
          visionPath = outPath;
        } else {
          execSync(`sips -Z 600 "${absPath}" --out "${outPath}" 2>/dev/null`, { stdio: 'pipe' });
          visionPath = outPath;
        }
      } catch {
        visionPath = absPath;
      }
    }
  }
  return visionPath;
}

function cleanup(paths) {
  for (const p of paths) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
}

async function callMoonBridge(prompt, imagePaths = [], titleHint = null) {
  const devContent = [
    '你是一个认知资产结构化专家。你需要将高质量认知内容提炼成以下字段，输出纯 JSON。',
    '',
    '字段：',
    '- topic: 所属主题（必须使用图片/内容本身的标题作为主题，不要自己编造主题。标题通常是内容最核心的概括，优先使用原文标题）',
    '- essence: 一句话精华（核心认知的一句话总结，10-25 字）',
    '- level: 层级（"道"|"法"|"术"|"器"）',
    '- core_question: 核心问题和使用场景（这个认知解决什么问题、在什么场景下有用，50-150 字）',
    '- original_text: 完整的长篇内容、原始文本（保留原文关键结构和金句；如果是图片则描述图中核心内容要点）',
    '- timeliness: 智慧时效性（"短期"|"中期"|"长期"|"永恒"）',
    '',
    '核心规则：topic（所属主题）必须使用内容/图片本身的原标题，不要自行概括或改写标题。只有当内容确实没有标题时才提炼。',
    '',
    '输出纯 JSON，不要 Markdown 包裹，不要其他文字。',
  ].join('\n');

  const input = [{ role: 'developer', content: devContent }];
  const tmpDirs = [];

  try {
    let userContent = '';
    if (titleHint) userContent += `[内容标题：${titleHint}]\n\n`;
    for (const imgPath of imagePaths) {
      const vp = prepareVisionImage(imgPath, tmpDirs);
      if (vp && existsSync(vp)) {
        const data = readFileSync(vp);
        const ext = vp.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        const mime = `image/${ext}`;
        const b64 = data.toString('base64');
        userContent += `[图片：data:${mime};base64,${b64}]\n\n`;
      }
    }
    userContent += prompt;

    input.push({ role: 'user', content: userContent });
    const body = { model: MODEL, input, temperature: 0.3, max_output_tokens: 2048 };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(MOONBRIDGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`); }
        if (data.status !== 'completed') {
          if (data.error?.message?.includes('too large') || data.error?.message?.includes('payload')) {
            // 如果图片太大还是失败，去掉图片重试
            if (imagePaths.length > 0 && attempt === 0) {
              console.error('  图片太大，降级为纯文字模式...');
              input[input.length - 1].content = (titleHint ? `[内容标题：${titleHint}]\n\n` : '') + prompt;
              attempt--;
              await sleep(1000);
              continue;
            }
          }
          throw new Error(`MoonBridge status=${data.status}: ${JSON.stringify(data.error || data).slice(0, 300)}`);
        }
        const content = data.output_text;
        if (!content) throw new Error('Empty response');
        const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        return JSON.parse(cleaned);
      } catch (err) {
        if (attempt < 2) {
          console.error(`MoonBridge attempt ${attempt + 1} failed: ${err.message.slice(0, 150)}, retrying...`);
          await sleep(2000);
        } else {
          throw new Error(`MoonBridge failed after 3 attempts: ${err.message}`);
        }
      }
    }
  } finally {
    cleanup(tmpDirs);
  }
}

function deduplicate(keyword) {
  if (!keyword) return null;
  try {
    const kw = keyword.replace(/"/g, '\\"').slice(0, 30);
    const result = execJson(
      `lark-cli base +record-search --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --keyword "${kw}" --search-field "所属主题" --limit 3 --format json 2>/dev/null`
    );
    if (result.ok && result.data?.record_id_list?.length > 0) {
      return result.data.record_id_list[0];
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
  const escaped = json.replace(/'/g, "'\\''");
  const result = execJson(
    `lark-cli base +record-upsert --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --json '${escaped}' --format json 2>/dev/null`
  );
  if (!result.ok) throw new Error(`Base 写入失败: ${JSON.stringify(result.error)}`);
  const recordId = result.data?.record?.record_id_list?.[0];
  if (!recordId) throw new Error(`无法解析 record_id from: ${JSON.stringify(result.data).slice(0, 300)}`);
  return recordId;
}

function uploadAttachments(recordId, imagePaths) {
  if (!imagePaths || imagePaths.length === 0) return 0;

  const tmpDirs = [];
  const fileArgs = [];

  try {
    for (const imgPath of imagePaths) {
      if (!existsSync(imgPath)) {
        console.error(`⚠️  文件不存在: ${imgPath}`);
        continue;
      }
      if (isAbsolute(imgPath)) {
        const tmpDir = mkdtempSync(join(tmpdir(), 'wg-img-'));
        tmpDirs.push(tmpDir);
        const dest = join(tmpDir, basename(imgPath));
        copyFileSync(imgPath, dest);
        fileArgs.push(`--file "${dest}"`);
      } else {
        fileArgs.push(`--file "${resolve(process.cwd(), imgPath)}"`);
      }
    }

    if (fileArgs.length === 0) return 0;

    const cmd = [
      'lark-cli base +record-upload-attachment',
      `--base-token ${BASE_TOKEN}`,
      `--table-id ${TABLE_ID}`,
      `--record-id ${recordId}`,
      `--field-id ${ATTACHMENT_FIELD_ID}`,
      ...fileArgs,
      '--format json',
    ].join(' ');

    const result = execJson(cmd + ' 2>/dev/null');
    if (result.ok) return fileArgs.length;
    console.error(`⚠️  附件上传失败: ${JSON.stringify(result.error).slice(0, 300)}`);
    return 0;
  } finally {
    cleanup(tmpDirs);
  }
}

function updateMemory(entry) {
  let memory = { schema: 'wisdom-gate-run-memory', runs: [] };
  try {
    memory = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
  } catch {}
  memory.runs.push({ ...entry, timestamp: new Date().toISOString() });
  if (memory.runs.length > 100) memory.runs = memory.runs.slice(-100);
  writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

const text = flags.text || (flags.images.length > 0 ? '请分析这张图中的认知内容。' : '');
let topicHint = '';
if (flags.topic) topicHint += `（所属主题提示：${flags.topic}）`;
if (flags.title) topicHint += `（内容标题：${flags.title}，topic 字段必须使用此标题）`;
let levelHint = '';
if (flags.level) levelHint += `\n层级固定为：${flags.level}`;
const prompt = `请分析以下认知内容${topicHint}${levelHint}：\n\n${text}`;

try {
  console.log(`🔍 MoonBridge 提取结构化信息${flags.images.length > 0 ? `（${flags.images.length} 张图片）` : ''}...`);
  let fields = await callMoonBridge(prompt, flags.images, flags.title || null);

  if (flags.title) fields.topic = flags.title;
  if (flags.level) fields.level = flags.level;

  console.log(`  主题: ${fields.topic}`);
  console.log(`  精华: ${fields.essence}`);
  console.log(`  层级: ${fields.level} | 时效: ${fields.timeliness}`);

  console.log('🔎 检查重复...');
  const existingId = deduplicate(fields.topic);
  if (existingId) {
    console.log(`⏭️  已存在记录 (${existingId})，追加附件...`);
    const uploaded = uploadAttachments(existingId, flags.images);
    console.log(`📎 追加了 ${uploaded} 张图片到已有记录。`);
    updateMemory({ action: 'appended', recordId: existingId, imageCount: uploaded, fields });
    console.log(`\n✅ 追加完成，新增 ${uploaded} 张图`);
    console.log(`🔗 ${BASE_URL}/${BASE_TOKEN}?table=${TABLE_ID}&record=${existingId}`);
    process.exit(0);
  }

  console.log('📝 写入智慧之门 Base...');
  const recordId = createRecord(fields);
  console.log(`✅ 记录已创建: ${recordId}`);

  let uploaded = 0;
  if (flags.images.length > 0) {
    console.log(`📎 上传 ${flags.images.length} 张附件（原图）...`);
    uploaded = uploadAttachments(recordId, flags.images);
    if (uploaded > 0) console.log(`✅ ${uploaded} 张附件上传成功`);
    else console.error('⚠️  附件上传失败');
  }

  updateMemory({ action: 'created', recordId, imageCount: uploaded, fields });
  console.log(`\n✅ 智慧之门入库完成：${fields.topic}`);
  console.log(`🔗 ${BASE_URL}/${BASE_TOKEN}?table=${TABLE_ID}&record=${recordId}`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  updateMemory({ action: 'failed', error: err.message, text: text?.slice(0, 200) });
  process.exit(1);
}
