import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync, existsSync, openSync, closeSync, fchmodSync, fstatSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWereadRange } from '../.agents/skills/learn-x-input/scripts/collect-weread-range.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(root, '.runtime/reading/workbench');
const dayMs = 86400000;
const todayShanghai = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0,10);
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0,10);

export function openStore(dir = stateDir, {readOnly = false} = {}) {
  for (let p = path.resolve(dir); p !== path.dirname(p); p = path.dirname(p)) if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('unsafe state path');
  if (!readOnly) { mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700); }
  const file = path.join(dir,'weread.sqlite3');
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw new Error('unsafe database path');
  if (readOnly) {
    if (!existsSync(file)) throw new Error('reading store unavailable');
    return new DatabaseSync(file,{readOnly:true});
  }
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
    const entry = db.prepare(`INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
      book_id=excluded.book_id,date=excluded.date,kind=excluded.kind,value=excluded.value WHERE ?`);
    for (const b of result.books || []) {
      book.run(b.bookId,b.title || '',b.author || '');
      for (const [kind, entries] of [['highlight',b.highlights || []],['thought',b.thoughts || []]]) for (const e of entries) {
        if (!e.sourceId || !e.identityVerified || !e.date) continue;
        entry.run(e.sourceId,b.bookId,e.date,kind,JSON.stringify(e),result.complete ? 1 : 0);
      }
    }
    const day = db.prepare(`INSERT INTO days(date,status,last_success,last_attempt,as_of,error) VALUES(?,?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET status=excluded.status,last_success=COALESCE(excluded.last_success,days.last_success),last_attempt=excluded.last_attempt,as_of=excluded.as_of,error=excluded.error`);
    const hasStoredEntries = db.prepare('SELECT 1 FROM entries WHERE date=? LIMIT 1');
    const failureCode = result.complete ? null : (result.errors || []).some(item => String(item.reason || '').startsWith('request-budget-exceeded'))
      ? 'request_budget_exceeded' : 'source_incomplete';
    for (let d=start;d<=end;d=shift(d,1)) {
      const full = result.complete && d < last;
      const hasEntries = Boolean(hasStoredEntries.get(d));
      const status = full ? 'success' : result.complete || hasEntries ? 'partial' : 'failed';
      day.run(d,status,full?stamp:null,stamp,result.range?.endExclusive || null,failureCode);
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

function checkpointKey(name) {
  return 'reading-workbench-sync:checkpoint:' + name;
}

function createCheckpoint(from, to) {
  return {
    schemaVersion: 1,
    from,
    to,
    rangeEpoch: null,
    phase: 'discover',
    discoveryCursor: null,
    seenDiscoveryCursors: [],
    candidateBooks: [],
    bookProgress: {},
    validationErrors: []
  };
}

function loadCheckpoint(db, key) {
  const raw = db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
  if (!raw) return null;
  let checkpoint;
  try { checkpoint = JSON.parse(raw); }
  catch { throw new Error('invalid saved synchronization checkpoint'); }
  if (checkpoint.schemaVersion !== 1 || typeof checkpoint.from !== 'string' || typeof checkpoint.to !== 'string') {
    throw new Error('invalid saved synchronization checkpoint');
  }
  return checkpoint;
}

function persistCheckpoint(db, key, {checkpoint, books = []}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const book = db.prepare('INSERT INTO books VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET title=excluded.title,author=excluded.author');
    const entry = db.prepare('INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET book_id=excluded.book_id,date=excluded.date,kind=excluded.kind,value=excluded.value');
    for (const item of books) {
      if (!item.bookId) continue;
      book.run(String(item.bookId),item.title || '',item.author || '');
      for (const [kind, entries] of [['highlight',item.highlights || []],['thought',item.thoughts || []]]) for (const value of entries) {
        if (!value.sourceId || value.identityVerified !== true || !/^\d{4}-\d{2}-\d{2}$/.test(value.date || '')) continue;
        entry.run(value.sourceId,String(item.bookId),value.date,kind,JSON.stringify(value));
      }
    }
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(checkpoint));
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

export async function synchronize(db, now = new Date(), collector = collectWereadRange, {requestBudget = 500, requestSpacingMs = 250} = {}) {
  if (!Number.isInteger(requestBudget) || requestBudget < 2 || requestBudget > 500 || !Number.isInteger(requestSpacingMs) || requestSpacingMs < 0) throw new Error('invalid request limits');
  // Separate SQLite database holds the cross-process lock without blocking
  // readers or the short transactions that commit each completed range.
  const mainPath = db.location();
  if (!mainPath) throw new Error('persistent store required for synchronization');
  const lockPath = path.join(path.dirname(mainPath), 'sync-lock.sqlite3');
  const lockFd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(lockFd).isFile()) throw new Error('unsafe synchronization lock');
    fchmodSync(lockFd,0o600);
  } finally { closeSync(lockFd); }
  const lock = new DatabaseSync(lockPath);
  try {
    lock.exec('BEGIN IMMEDIATE');
  } catch (error) {
    lock.close();
    throw new Error('another synchronization is running', {cause:error});
  }
  try {
  const today = todayShanghai(now), yesterday=shift(today,-1);
  let baseline = db.prepare("SELECT value FROM meta WHERE key='baseline'").get()?.value;
  if (!baseline) { baseline=shift(today,-3); db.prepare("INSERT INTO meta VALUES('baseline',?)").run(baseline); }
  let oldest=null;
  const success = db.prepare('SELECT status FROM days WHERE date=?');
  for(let d=baseline;d<=yesterday;d=shift(d,1)) if(success.get(d)?.status !== 'success'){oldest=d;break;}
  const checkpointed=collector===collectWereadRange;
  const tasks=[];
  const recoveryKey=checkpointKey('recovery'), recentKey=checkpointKey('recent');
  let recoveryCheckpoint=checkpointed?loadCheckpoint(db,recoveryKey):null;
  if(oldest){
    if(checkpointed){
      if(!recoveryCheckpoint || recoveryCheckpoint.from!==oldest || recoveryCheckpoint.to<oldest || recoveryCheckpoint.to>yesterday){
        recoveryCheckpoint=createCheckpoint(oldest,[shift(oldest,6),yesterday].sort()[0]);
      }
      tasks.push({name:'recovery',key:recoveryKey,checkpoint:recoveryCheckpoint});
    }else{
      let recoveryDays=7;
      const raw=db.prepare("SELECT value FROM meta WHERE key='recovery_window'").get()?.value;
      if(raw){
        let value;
        try{value=JSON.parse(raw);}catch{throw new Error('invalid recovery window');}
        if(value.oldest===oldest && Number.isInteger(value.days) && value.days>=1 && value.days<=7) recoveryDays=value.days;
      }
      tasks.push({name:'recovery',from:oldest,to:[shift(oldest,recoveryDays-1),yesterday].sort()[0],recoveryDays});
    }
  }else{
    if(checkpointed) db.prepare('DELETE FROM meta WHERE key=?').run(recoveryKey);
  }
  if(checkpointed){
    let recentCheckpoint=loadCheckpoint(db,recentKey);
    if(!recentCheckpoint || recentCheckpoint.to!==today){
      recentCheckpoint=createCheckpoint(shift(today,-3),today);
    }
    tasks.push({name:'recent',key:recentKey,checkpoint:recentCheckpoint});
    db.prepare("DELETE FROM meta WHERE key='recovery_window'").run();
  }else{
    tasks.push({name:'recent',from:shift(today,-3),to:today});
  }
  let completed=0;
  let lastCall = 0;
  for (const task of tasks) {
      const {from,to}=task.checkpoint || task;
      let calls=0,chain=Promise.resolve();
      const budget=tasks.length>1?Math.floor(requestBudget/tasks.length):requestBudget;
      const originalFetch=globalThis.fetch;
      if(checkpointed) globalThis.fetch = (input, options = {}) => {
        const next = chain.then(async () => {
          if (++calls > budget) throw Object.assign(new Error('request budget exceeded'),{code:'REQUEST_BUDGET_EXCEEDED'});
          const wait = Math.max(0, requestSpacingMs - (Date.now() - lastCall));
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          lastCall = Date.now();
          return originalFetch(input, {...options, signal: AbortSignal.timeout(15000)});
        });
        chain = next.catch(() => {});
        return next;
      };
      let result;
      try {
        const options={from,to,preserveRaw:true};
        if(checkpointed){
          options.checkpointMode=true;
          options.checkpoint=task.checkpoint;
          options.onCheckpoint=(event)=>persistCheckpoint(db,task.key,event);
        }
        result=await collector(options);
      }catch(error){
        result={complete:false,books:[],range:null,errors:[{reason:error.message}]};
      }finally{
        if(checkpointed) globalThis.fetch=originalFetch;
      }
      saveRange(db,result,from,to,now);
      if(result.complete){
        if(task.key) db.prepare('DELETE FROM meta WHERE key=?').run(task.key);
        if(task.name==='recovery' && !checkpointed) db.prepare("DELETE FROM meta WHERE key='recovery_window'").run();
        completed++;
      }else if(task.name==='recovery' && !checkpointed){
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run('recovery_window',JSON.stringify({oldest:from,days:Math.max(1,Math.floor(task.recoveryDays/2))}));
      }
  }
  const incomplete=tasks.length-completed;
  return {ranges:tasks.length,completed,incomplete,complete:incomplete===0};
  } finally {
    try { lock.exec('ROLLBACK'); } finally { lock.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const command=process.argv[2];const db=openStore(stateDir,{readOnly:command==='query'});
  try {
    if(command==='sync') console.log(JSON.stringify(await synchronize(db)));
    else if(command==='query') console.log(JSON.stringify(query(db,process.argv[3],process.argv[4],process.argv[5]||null)));
    else throw new Error('usage: sync | query FROM TO [BOOK_ID]');
  } finally { db.close(); }
}
