import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, chmodSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openStore, saveRange, synchronize, query } from './reading-workbench-sync.mjs';

const sample = {complete:true,range:{endExclusive:'2026-11-18 12:00:00'},books:[{bookId:'b',title:'Book',author:'Author',highlights:[{sourceId:'s',identityVerified:true,date:'2026-11-17',text:'原文  保留'}],thoughts:[]}]};
test('deduplicates and preserves verified entries through partial failure', () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try { const now=new Date('2026-11-18T04:00:00Z');saveRange(db,sample,'2026-11-17','2026-11-17',now);saveRange(db,{...sample,complete:false,books:[{...sample.books[0],highlights:[{...sample.books[0].highlights[0],text:'changed'}]}]},'2026-11-17','2026-11-17',now);const result=query(db,'2026-11-17','2026-11-17');assert.equal(result.books[0].highlights.length,1);assert.equal(result.books[0].highlights[0].text,'原文  保留');assert.deepEqual(result.gaps,['2026-11-17']);assert.ok(result.days[0].last_success); } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('backfills missing days and keeps today explicitly partial', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {const calls=[];await synchronize(db,new Date('2026-11-18T04:00:00Z'),async opts=>{calls.push(opts);return sample});assert.equal(calls.length,2);const result=query(db,'2026-11-16','2026-11-18');assert.deepEqual(result.gaps,['2026-11-18']);assert.equal(result.books[0].highlights[0].text,'原文  保留');} finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed rescan remains eligible after it leaves the recent window', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {
  db.prepare("INSERT INTO meta VALUES('baseline','2026-11-16')").run();
  const full={complete:true,books:[],range:{endExclusive:'2026-11-20'}};
  saveRange(db,full,'2026-11-16','2026-11-19',new Date('2026-11-20T04:00:00Z'));
  saveRange(db,{complete:false,books:[],range:null},'2026-11-16','2026-11-16',new Date('2026-11-18T04:00:00Z'));
  const calls=[]; await synchronize(db,new Date('2026-11-20T04:00:00Z'),async opts=>{calls.push(opts);return full});
  assert.equal(calls[0].from,'2026-11-16'); assert.deepEqual(query(db,'2026-11-16','2026-11-16').gaps,[]);
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('corrected source date updates the query index', () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {const now=new Date('2026-11-20T04:00:00Z');saveRange(db,sample,'2026-11-17','2026-11-18',now);const changed=structuredClone(sample);changed.books[0].highlights[0].date='2026-11-18';saveRange(db,changed,'2026-11-17','2026-11-18',now);assert.equal(query(db,'2026-11-17','2026-11-17').books.length,0);assert.equal(query(db,'2026-11-18','2026-11-18').books[0].highlights[0].date,'2026-11-18');} finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('older incomplete scan cannot consume the recent scan request budget', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 const oldFetch=globalThis.fetch, oldKey=process.env.WEREAD_API_KEY;let discoveries=0;
 process.env.WEREAD_API_KEY='synthetic';
 globalThis.fetch=async (_url, options)=>{
  const input=JSON.parse(options.body);let data;
  if(input.api_name==='/user/notebooks'){discoveries++;data={hasMore:0,books:Array.from({length:discoveries===1?2:1},(_,i)=>({bookId:`b${i}`,sort:1795100000,book:{title:'B'}}))};}
  else if(input.api_name==='/book/bookmarklist')data={chapters:[],updated:[]};
  else data={reviews:[],hasMore:0};
  return {ok:true,json:async()=>data};
 };
 try {db.prepare("INSERT INTO meta VALUES('baseline','2026-11-01')").run();const result=await synchronize(db,new Date('2026-11-20T04:00:00Z'),undefined,{requestBudget:6,requestSpacingMs:0});assert.equal(discoveries,2);assert.equal(result.ranges,2);assert.equal(result.completed,1);assert.equal(result.incomplete,1);assert.equal(result.complete,false);}
 finally {globalThis.fetch=oldFetch;if(oldKey===undefined) delete process.env.WEREAD_API_KEY;else process.env.WEREAD_API_KEY=oldKey;db.close();rmSync(dir,{recursive:true,force:true});}
});
test('partial source with saved entries remains visibly partial', () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {saveRange(db,{...sample,complete:false},'2026-11-17','2026-11-17',new Date('2026-11-18T04:00:00Z'));const result=query(db,'2026-11-17','2026-11-17');assert.equal(result.days[0].status,'partial');assert.deepEqual(result.gaps,['2026-11-17']);} finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('concurrent synchronization fails closed without changing the running scan', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const first=openStore(dir),second=openStore(dir);let release, notify;
 const started=new Promise(resolve=>{notify=resolve});const gate=new Promise(resolve=>{release=resolve});
 try {const running=synchronize(first,new Date('2026-11-20T04:00:00Z'),async()=>{notify();await gate;return sample});await started;await assert.rejects(synchronize(second,new Date('2026-11-20T05:00:00Z'),async()=>sample),/another synchronization/);release();await running;const retried=await synchronize(second,new Date('2026-11-20T05:00:00Z'),async()=>sample);assert.ok(retried.complete>0);}
 finally {release();first.close();second.close();rmSync(dir,{recursive:true,force:true});}
});

test('process exit releases the synchronization lock', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 const code="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('ready');setInterval(()=>{},1000)";
 const child=spawn(process.execPath,['-e',code,path.join(dir,'sync-lock.sqlite3')],{stdio:['ignore','pipe','ignore']});
 try {
  const [chunk]=await once(child.stdout,'data');assert.match(chunk.toString(),/ready/);
  await assert.rejects(synchronize(db,new Date('2026-11-20T04:00:00Z'),async()=>sample),/another synchronization/);
  child.kill('SIGKILL');await once(child,'exit');
  const result=await synchronize(db,new Date('2026-11-20T04:00:00Z'),async()=>sample);assert.ok(result.complete>0);
 } finally {if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');db.close();rmSync(dir,{recursive:true,force:true});}
});

test('query store opens existing data read-only without changing permissions', () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {saveRange(db,sample,'2026-11-17','2026-11-17',new Date('2026-11-18T04:00:00Z'));} finally {db.close();}
 const file=path.join(dir,'weread.sqlite3');chmodSync(file,0o400);
 try {const reader=openStore(dir,{readOnly:true});try {assert.equal(query(reader,'2026-11-17','2026-11-17').books.length,1);assert.throws(()=>reader.exec('DELETE FROM entries'));} finally {reader.close();}assert.equal(statSync(file).mode & 0o777,0o400);} finally {rmSync(dir,{recursive:true,force:true});}
});
test('read-only query does not create a missing store', () => {
 const dir=path.join(realpathSync(os.tmpdir()),`missing-readx-${process.pid}-${Date.now()}`);
 assert.throws(()=>openStore(dir,{readOnly:true}),/reading store unavailable/);
});
test('read-only query remains available while synchronization waits on network', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);let release,notify;
 const started=new Promise(resolve=>{notify=resolve});const gate=new Promise(resolve=>{release=resolve});
 try {saveRange(db,sample,'2026-11-17','2026-11-17',new Date('2026-11-18T04:00:00Z'));const running=synchronize(db,new Date('2026-11-20T04:00:00Z'),async()=>{notify();await gate;return sample});await started;const reader=openStore(dir,{readOnly:true});try{assert.equal(query(reader,'2026-11-17','2026-11-17').books.length,1);}finally{reader.close();}release();await running;}
 finally {release();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('a large failed backlog narrows its batch until individual days can advance', async () => {
 const dir=mkdtempSync(path.join(realpathSync(os.tmpdir()),'readx-book-test-'));const db=openStore(dir);
 try {
  db.prepare("INSERT INTO meta VALUES('baseline','2026-11-01')").run();const calls=[];
  const collector=async opts=>{calls.push([opts.from,opts.to]);return {complete:opts.from===opts.to || opts.from==='2026-11-17',books:[],range:{endExclusive:'2026-11-20'}};};
  for(let i=0;i<4;i++) await synchronize(db,new Date('2026-11-20T04:00:00Z'),collector);
  assert.deepEqual(calls.filter(x=>x[0]==='2026-11-01').map(x=>x[1]),['2026-11-07','2026-11-03','2026-11-01']);
  assert.equal(query(db,'2026-11-01','2026-11-01').days[0].status,'success');
  assert.equal(calls.at(-2)[0],'2026-11-02');
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
