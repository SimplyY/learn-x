import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
