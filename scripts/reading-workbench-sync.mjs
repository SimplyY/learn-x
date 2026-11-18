import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWereadRange } from '../.agents/skills/learn-x-input/scripts/collect-weread-range.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(root, '.runtime/reading/workbench');
const dayMs = 86400000;
const todayShanghai = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0,10);
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0,10);

export function openStore(dir = stateDir) {
  for (let p = path.resolve(dir); p !== path.dirname(p); p = path.dirname(p)) if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('unsafe state path');
  mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700);
  const file = path.join(dir,'weread.sqlite3');
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('unsafe database path');
  const db = new DatabaseSync(file); chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS days(date TEXT PRIMARY KEY, status TEXT NOT NULL, last_success TEXT, last_attempt TEXT NOT NULL, as_of TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS entries(source_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS books(book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
}

export function saveRange(db, result, start, end, now) {
  const last = todayShanghai(now), stamp = now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const book = db.prepare('INSERT INTO books VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET title=excluded.title,author=excluded.author');
    const entry = db.prepare('INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET value=CASE WHEN ? THEN excluded.value ELSE entries.value END');
    for (const b of result.books || []) {
      book.run(b.bookId,b.title || '',b.author || '');
      for (const [kind, entries] of [['highlight',b.highlights || []],['thought',b.thoughts || []]]) for (const e of entries) {
        if (!e.sourceId || !e.identityVerified || !e.date) continue;
        entry.run(e.sourceId,b.bookId,e.date,kind,JSON.stringify(e),result.complete ? 1 : 0);
      }
    }
    const day = db.prepare(`INSERT INTO days(date,status,last_success,last_attempt,as_of,error) VALUES(?,?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET status=excluded.status,last_success=COALESCE(excluded.last_success,days.last_success),last_attempt=excluded.last_attempt,as_of=excluded.as_of,error=excluded.error`);
    for (let d=start;d<=end;d=shift(d,1)) {
      const full = result.complete && d < last;
      day.run(d,full?'success':result.complete?'partial':'failed',full?stamp:null,stamp,result.range?.endExclusive || null,result.complete?null:'source_incomplete');
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

export function query(db, from, to, bookId = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('invalid range');
  const days = db.prepare('SELECT date,status,last_success,as_of,error FROM days WHERE date>=? AND date<=? ORDER BY date').all(from,to);
  const rows = db.prepare('SELECT e.kind,e.value,b.book_id,b.title,b.author FROM entries e JOIN books b ON b.book_id=e.book_id WHERE e.date>=? AND e.date<=? AND (? IS NULL OR e.book_id=?) ORDER BY e.date,e.source_id').all(from,to,bookId,bookId);
  const books = new Map();
  for(const r of rows){ if(!books.has(r.book_id)) books.set(r.book_id,{bookId:r.book_id,title:r.title,author:r.author,highlights:[],thoughts:[]});books.get(r.book_id)[r.kind==='highlight'?'highlights':'thoughts'].push(JSON.parse(r.value)); }
  const known=new Set(days.map(d=>d.date)), gaps=[];
  for(let d=from;d<=to;d=shift(d,1)) if(!known.has(d) || days.find(x=>x.date===d).status!=='success') gaps.push(d);
  return {schemaVersion:1,timezone:'Asia/Shanghai',from,to,days,gaps,books:[...books.values()]};
}

export async function synchronize(db, now = new Date(), collector = collectWereadRange) {
  const today = todayShanghai(now), yesterday=shift(today,-1);
  let baseline = db.prepare("SELECT value FROM meta WHERE key='baseline'").get()?.value;
  if (!baseline) { baseline=shift(today,-2); db.prepare("INSERT INTO meta VALUES('baseline',?)").run(baseline); }
  let oldest=null;
  const success = db.prepare('SELECT last_success FROM days WHERE date=?');
  for(let d=baseline;d<=yesterday;d=shift(d,1)) if(!success.get(d)?.last_success){oldest=d;break;}
  const ranges=[];
  if(oldest) ranges.push([oldest, [shift(oldest,6),yesterday].sort()[0]]);
  ranges.push([shift(today,-2),today]);
  let completed=0;
  const originalFetch = globalThis.fetch;
  let calls = 0, lastCall = 0, chain = Promise.resolve();
  if (collector === collectWereadRange) globalThis.fetch = (input, options = {}) => {
    const next = chain.then(async () => {
      if (++calls > 500) throw new Error('request budget exceeded');
      const wait = Math.max(0, 250 - (Date.now() - lastCall));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastCall = Date.now();
      return originalFetch(input, {...options, signal: AbortSignal.timeout(15000)});
    });
    chain = next.catch(() => {});
    return next;
  };
  try { for(const [from,to] of ranges){
    let result;
    try {result=await collector({from,to,skillVersion:'1.0.6',preserveRaw:true});}
    catch {result={complete:false,books:[],range:null};}
    saveRange(db,result,from,to,now); if(result.complete) completed++;
  } } finally { globalThis.fetch = originalFetch; }
  return {ranges:ranges.length,complete:completed};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const command=process.argv[2];const db=openStore();
  try {
    if(command==='sync') console.log(JSON.stringify(await synchronize(db)));
    else if(command==='query') console.log(JSON.stringify(query(db,process.argv[3],process.argv[4],process.argv[5]||null)));
    else throw new Error('usage: sync | query FROM TO [BOOK_ID]');
  } finally { db.close(); }
}
