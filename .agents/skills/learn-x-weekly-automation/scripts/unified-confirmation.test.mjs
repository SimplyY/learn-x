import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareWeeklyMemory, bindWeeklyMemoryApproval } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';
import { executeConfirmedLearnXCloseout, prepareUnifiedPreview, validateUnifiedBaselines } from './unified-confirmation.mjs';
import { recordDisplayedCard, confirmDisplayedCard } from '../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation-session.mjs';

async function fixture(t) {
 const root=await mkdtemp(path.join(os.tmpdir(),'unified-week-')); t.after(()=>rm(root,{recursive:true,force:true})); const dir=path.join(root,'04_output/_dist/weekly/2026-W40');
 await mkdir(dir,{recursive:true}); await mkdir(path.join(root,'04_output/weekly'),{recursive:true});
 await writeFile(path.join(root,'04_output/weekly/2026-40.md'),'# Learn-X Weekly Output｜2026-40\n\n## 11. 全文核心重点纪要\n本周总结\n\n## 12. 芒格之魂的洞察\n本周洞察\n');
 await prepareWeeklyMemory({week:'2026-W40',repoRoot:root}); await writeFile(path.join(dir,'memory-proposed.md'),'## 2026-W40\n\n- 第一条\n- 第二条\n');
 const binding=await bindWeeklyMemoryApproval({week:'2026-W40',repoRoot:root}); const s=binding.scope;
 const closeoutEntries=[{id:'backup',action:`备份 ${s.backupRoots.join('、')} 并按既有规则清理留存`,destination:s.backupDestination},{id:'ywnext',action:'刷新',destination:s.ywnext},{id:'flomo',action:'同步周记和季度记忆',sources:s.flomo,destination:'Flomo/本人已验证账户/周记及季度记忆'}];
 return {root,binding,closeoutEntries};
}
const core = [{id:'core-human',domain:'core',source:'human',locator:'复盘/本周思考',originalValue:'',value:'本人思考',targets:['export']},{id:'core-ai',domain:'core',source:'ai',locator:'复盘/挑战',originalValue:'',value:'AI候选',targets:['export']}];
const coreSource={docId:'core-test-doc',revisionId:'1',documentSha256:'c'.repeat(64),proposalSha256:'d'.repeat(64)};

test('联合预览：逐项修改排除，显示精确条目与目标，同一认可只保存保留项',async t=>{
 const {root,binding,closeoutEntries}=await fixture(t); const result=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',learnX:{fingerprint:binding.fingerprint,selectedIds:['memory-2','closeout-backup'],edits:{'memory-2':'- 修改之后\n'},closeoutEntries},coreCandidates:core,coreSelectedIds:['core-human'],coreSource});
 assert.match(result.unified.display,/修改之后/); assert.match(result.unified.display,/排除：core-ai/); assert.match(result.unified.display,/排除：excluded-memory-1/); assert.notEqual(result.learnXFingerprint,binding.fingerprint);
 const shown={id:'om_card',sender:'bot',type:'bot',chatId:'oc_test',text:result.unified.display,sentAt:'2026-10-12T08:00:00+08:00',turnId:'display-turn',turnIndex:1}; const fetchDisplay=async()=>shown;
 const {file}=await recordDisplayedCard({root,unified:result.unified,displayMessageId:shown.id,chatId:shown.chatId,expectedBot:'bot',fetchDisplay});
 const reply={id:'om_reply',sender:'human',type:'user',chatId:shown.chatId,text:result.unified.card.confirmationText,sentAt:'2026-10-12T09:00:00+08:00',turnId:'confirmation-turn',turnIndex:0};
 const confirm=()=>confirmDisplayedCard({root,receiptFile:file,messageId:reply.id,expectedSender:'human',expectedBot:'bot',chatId:shown.chatId,fetchDisplay,fetchMessage:async()=>reply,validateBaselines:card=>validateUnifiedBaselines({learnXRoot:root,card,validateCore:async()=>({ok:true})})});
 const resultBatch=await confirm(); assert.deepEqual(resultBatch.batch.items.map(x=>x.id),['memory-1','closeout-backup','core-human']); assert.equal(resultBatch.batch.sourceBindings.learnxMemoryFingerprint,result.learnXFingerprint); assert.equal(resultBatch.batch.confirmedAt,reply.sentAt);
 assert.match(await readFile(path.join(root,'04_output/_dist/weekly/2026-W40/memory-proposed.md'),'utf8'),/修改之后/);
 await writeFile(path.join(root,'04_output/_dist/weekly/2026-W40/memory-proposed.md'),'## 2026-W40\n- 外部修改\n');
 await assert.rejects(confirm(),/changed/);
});

test('Core 暂缓：Learn-X 先完成，Core 后续独立预览，AI 未选不进入卡',async t=>{
 const {root,binding,closeoutEntries}=await fixture(t);
 const first=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',learnX:{fingerprint:binding.fingerprint,selectedIds:['memory-1','memory-2','closeout-backup'],closeoutEntries}}); assert.equal(first.unified.card.items.every(x=>x.domain==='learn-x'),true);
 const next=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',coreCandidates:core,coreSelectedIds:['core-human'],coreSource}); assert.deepEqual(next.unified.card.items.map(x=>x.id),['core-human']); assert.equal(next.unified.card.sourceBindings.coreReview.docId,'core-test-doc');
});

test('模拟 Codex 宿主：真实提案修改排除后展示、确认与 Memory 指纹同批绑定',async t=>{
 const {root,binding,closeoutEntries}=await fixture(t);
 const {recordCodexCard,confirmCodexCard}=await import('./unified-confirmation.mjs');
 const {verifyWeeklyMemoryApproval}=await import('../../learn-x-process/scripts/prepare-weekly-memory.mjs');
 const result=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',learnX:{fingerprint:binding.fingerprint,selectedIds:['memory-2','closeout-backup'],edits:{'memory-2':'- 经本人修改\n'},closeoutEntries},coreCandidates:core,coreSelectedIds:['core-human'],coreSource});
 const threadId='thread-test', turnId='turn-test', displayId='display-test', replyId='reply-test';
 const shown=result.unified.display, reply=result.unified.card.confirmationText;
 const host={readThread:async()=>({thread:{id:threadId},page:{order:'newest_first'},turns:[{id:'confirmation-turn',startedAt:1793326523,items:[{type:'userMessage',id:replyId,content:[{type:'text',text:reply}]}]},{id:turnId,startedAt:1793326522,items:[{type:'agentMessage',id:displayId,text:shown}]}]})};
 const recorded=await recordCodexCard({stateRoot:root,unified:result.unified,threadId,displayMessageId:displayId,host});
 const accepted=await confirmCodexCard({learnXRoot:root,stateRoot:root,week:'2026-W40',fingerprint:result.unified.card.fingerprint,threadId,receiptFile:recorded.file,messageId:replyId,host,validateCore:async()=>({ok:true})});
 assert.equal(accepted.batch.confirmedAt,'2026-10-30T02:15:23.000Z');
 assert.equal(accepted.batch.sourceBindings.learnxMemoryFingerprint,result.learnXFingerprint);
 assert.deepEqual(accepted.batch.items.map(x=>x.id),['memory-1','closeout-backup','core-human']);
 await verifyWeeklyMemoryApproval({week:'2026-W40',fingerprint:accepted.batch.sourceBindings.learnxMemoryFingerprint,repoRoot:root});
 await assert.rejects(recordCodexCard({stateRoot:root,unified:result.unified,threadId,displayMessageId:displayId,host:{...host,readThread:async()=>({thread:{id:'other'},turns:[]})}}));
});

test('确认收尾入口绑定已认可批次，只在 Memory 读回成功后执行获准动作', async t => {
 const {root,binding,closeoutEntries}=await fixture(t);
 const closeout=closeoutEntries.find(entry=>entry.id==='backup');
 const batch={batchId:'test-closeout-batch',reviewWeek:'2026-W40',confirmedAt:'2026-10-30T10:00:00+08:00',sourceBindings:{learnxMemoryFingerprint:binding.fingerprint},items:[
  {id:'memory-1',domain:'learn-x',targets:['memory']},
  {id:'closeout-backup',domain:'learn-x',targets:['weekly-closeout'],locator:closeout.destination,value:closeout.action}
 ]};
 let calls=0;
 const verifyMemoryApproval=async ({week,fingerprint,repoRoot})=>{assert.equal(week,'2026-W40');assert.equal(fingerprint,binding.fingerprint);assert.equal(repoRoot,root);return {verified:true,week,fingerprint};};
 const executors={backup:async()=>{calls+=1;return {ok:true,status:'verified',evidence:{snapshotId:'mock-snapshot',readback:true}};}};
 const pending=await executeConfirmedLearnXCloseout({batch,learnXRoot:root,stateRoot:root,verifyMemoryApproval,executors});
 assert.equal(pending.status,'pending-memory-readback');
 assert.equal(calls,0);
 const approvalEvidence={verified:true,week:'2026-W40',fingerprint:binding.fingerprint};
 const completed=await executeConfirmedLearnXCloseout({batch,learnXRoot:root,stateRoot:root,approvalEvidence,memoryWriteEvidence:{ok:true,status:'verified',evidence:{memoryReadback:true}},executors});
 assert.equal(completed.status,'completed');
 assert.equal(completed.results.backup.status,'completed');
 assert.equal(calls,1);
 const ledger=JSON.parse(await readFile(path.join(root,'runtime/weekly-review/2026-W40/closeout',`${batch.batchId}.json`),'utf8'));
 assert.deepEqual(Object.keys(ledger.memoryWriteEvidence.evidence),['sha256']);
});

test('Core 同步抛错不撤销已保存认可，也不阻塞 Learn-X 收尾',async t=>{
 const {root}=await fixture(t);
 const {recordCodexCard,confirmAndSyncCodexBatch}=await import('./unified-confirmation.mjs');
 const result=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',coreCandidates:[core[0]],coreSelectedIds:['core-human'],coreSource});
 const threadId='thread-pending', displayId='display-pending', replyId='reply-pending';
 const host={readThread:async()=>({thread:{id:threadId},page:{order:'newest_first'},turns:[
  {id:'confirmation-turn',startedAt:1793326523,items:[{type:'userMessage',id:replyId,content:[{type:'text',text:result.unified.card.confirmationText}]}]},
  {id:'display-turn',startedAt:1793326522,items:[{type:'agentMessage',id:displayId,text:result.unified.display}]}
 ]})};
 const recorded=await recordCodexCard({stateRoot:root,unified:result.unified,threadId,displayMessageId:displayId,host});
 const accepted=await confirmAndSyncCodexBatch({learnXRoot:root,stateRoot:root,week:'2026-W40',fingerprint:result.unified.card.fingerprint,threadId,receiptFile:recorded.file,displayMessageId:displayId,messageId:replyId,host,validateCore:async()=>({ok:true}),syncBatch:async()=>{throw new Error('mock target unavailable');}});
 assert.equal(accepted.batch.items[0].id,'core-human');
 assert.equal(accepted.coreSync.ok,false);
 assert.equal(accepted.coreSync.status,'pending');
 assert.match(accepted.coreSync.error,/mock target unavailable/);
 assert.match(accepted.file,/confirmations/);
 assert.equal(JSON.parse(await readFile(accepted.file,'utf8')).batchId,accepted.batch.batchId);
});

test('后续 Core 预览跳过已明确认可的内容，只为变化后的候选生成新批次',async t=>{
 const {root}=await fixture(t);
 const {prepareConfirmationCard,confirmCard}=await import('../../../../../core/.agents/skills/core-weekly/scripts/weekly-review-lib/confirmation.mjs');
 const original={...core[0],sourceValue:'原候选'};
 const acceptedCard=prepareConfirmationCard({reviewWeek:'2026-W40',items:[original],sourceBindings:{coreReview:coreSource}});
 await confirmCard({root,card:acceptedCard,messageId:'core-accepted',expectedSender:'human',fetchConfirmation:async id=>({id,sender:'human',text:acceptedCard.confirmationText,sentAt:'2026-10-31T10:00:00+08:00'})});
 const repeated=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',coreCandidates:[original],coreSelectedIds:['core-human'],coreSource});
 assert.equal(repeated.status,'no-new-items');
 assert.deepEqual(repeated.alreadyConfirmedCoreIds,['core-human']);
 const changed={...original,value:'本人补充后的新判断',sourceValue:'更新后的候选'};
 const next=await prepareUnifiedPreview({learnXRoot:root,stateRoot:root,week:'2026-W40',coreCandidates:[changed],coreSelectedIds:['core-human'],coreSource});
 assert.equal(next.status,'ready');
 assert.deepEqual(next.unified.card.items.map(item=>item.value),['本人补充后的新判断']);
});
