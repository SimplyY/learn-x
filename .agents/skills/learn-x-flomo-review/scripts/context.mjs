import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readCoreTruth } from '/Users/yuwei/code/core/scripts/read-core-truth.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw Error('invalid-date');
  return date;
}
function weekId(day) {
  const d = new Date(day); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export function completedPeriods(date) {
  validDate(date);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() || 7) + 1);
  const weeks = Array.from({ length: 4 }, (_, i) => weekId(new Date(day.getTime() - (i + 1) * 7 * 86400000)));
  const months = Array.from({ length: 2 }, (_, i) => {
    const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 2 - i, 1));
    return d.toISOString().slice(0, 7);
  });
  return { weeks, months };
}
async function optional(file) {
  try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function substantive(content) {
  const text = String(content || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const body = text.split('\n').filter(line => !/^\s*#{1,6}\s/.test(line))
    .map(line => line.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)?(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(line => !/^(?:todo|tbd|待补充|待填写|待生成|请填写|请补充|占位|暂无正文)(?:\s|[：:。]|$)/i.test(line))
    .join('\n').trim();
  return body.length >= 120;
}
export async function buildReviewContext(repoRoot, { date = shanghaiDate(), readDao = () => readCoreTruth('dao') } = {}) {
  const periods = completedPeriods(date), materials = [], missing = [];
  const add = (p, content, role, extra = {}) => materials.push({ path: p, role, content, sha256: sha256(content), ...extra });
  for (const [kind, ids] of [['weekly', periods.weeks], ['monthly', periods.months]]) {
    for (const id of ids) {
      const candidates = kind === 'weekly' ? [`04_output/weekly/${id.replace('-W', '-')}.md`, `04_output/weekly/${id}.md`] : [`04_output/monthly/${id}.md`];
      const present = [];
      for (const p of candidates) { const text = await optional(path.join(repoRoot, p)); if (text !== null && substantive(text)) present.push([p, text]); }
      if (present.length > 1 && new Set(present.map(([, text]) => sha256(text))).size > 1) throw Error(`ambiguous-output:${id}`);
      if (!present.length) missing.push({ role: kind, period: id, reason: 'missing-or-placeholder' });
      else add(...present[0], kind, { period: id, confirmation: 'archived-context-not-new-confirmation' });
    }
  }
  if (!materials.length) throw Error('weekly-and-monthly-context-missing');
  const dao = await readDao();
  if (dao.kind !== 'dao' || !dao.content?.trim() || !Number.isInteger(dao.revision) || sha256(dao.content) !== dao.sha256) throw Error('dao-context-invalid');
  add('Core/道', dao.content, 'dao', { sourceUrl: dao.sourceUrl, revision: dao.revision, readAt: dao.readAt });
  const memoryDir = path.join(repoRoot, '01_core/memory');
  const names = (await readdir(memoryDir)).filter(name => /^\d{4}(?:-Q[1-4])?\.memory\.md$/.test(name)).sort();
  if (!names.length) throw Error('active-memory-missing');
  for (const name of names) { const p = `01_core/memory/${name}`; const text = await readFile(path.join(repoRoot, p), 'utf8'); if (!text.trim()) throw Error('active-memory-empty'); add(p, text, 'memory'); }
  for (const p of ['01_core/memory/ChatGPT-AI记忆版.md', '01_core/ChatGPT-自我阅读版.md']) {
    const content = await optional(path.join(repoRoot, p));
    if (!content?.trim()) { missing.push({ path: p, reason: 'profile-missing' }); continue; }
    add(p, content, 'profile', { freshness: 'unverified-export-provenance' });
  }
  // Preserve export evidence without treating the latest failed attempt as a successful refresh.
  const exports = [];
  for (const id of periods.months) {
    const p = `04_output/_dist/monthly/${id}/chatgpt-understanding.json`, raw = await optional(path.join(repoRoot, p));
    if (raw) { const s = JSON.parse(raw); exports.push({ period: id, status: s.status, completedAt: s.completedAt || null, outputSha256: s.outputSha256 || null }); }
  }
  for (const material of materials.filter(m => m.role === 'profile')) {
    const key = material.path.includes('AI记忆') ? 'memory' : 'self';
    const confirmed = exports.find(e => e.status === 'succeeded' && e.outputSha256?.[key] === sha256(material.content.trim()));
    if (confirmed) Object.assign(material, { freshness: 'verified-last-successful-export', exportPeriod: confirmed.period, exportedAt: confirmed.completedAt });
  }
  const manifest = { date, periods, missing, profileExports: exports, sources: materials.map(({ content, ...meta }) => meta) };
  const contextHash = sha256(JSON.stringify(materials.map(({ path, sha256 }) => ({ path, sha256 }))));
  return { contextHash, materials, manifest };
}
export function validateEvidence(items, context) {
  for (const item of items) {
    if (!Array.isArray(item.contextEvidence) || !item.contextEvidence.length) throw Error('recommendation-evidence-missing');
    for (const evidence of item.contextEvidence) {
      const source = context.materials.find(x => x.path === evidence.path);
      if (!source || typeof evidence.quote !== 'string' || evidence.quote.trim().length < 6 || !source.content.includes(evidence.quote)) throw Error('recommendation-evidence-untraceable');
    }
    if (item.relevance === 'strong' && !item.contextEvidence.some(e => context.materials.some(x => x.path === e.path && ['weekly', 'monthly'].includes(x.role)))) throw Error('strong-match-needs-output-evidence');
  }
}
