import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareWeeklyMemory, bindWeeklyMemoryApproval } from '../../learn-x-process/scripts/prepare-weekly-memory.mjs';
import { parseMemoryProposal, reconstructApprovedMemory, buildLearnXConfirmationInputs, stageLearnXCard } from './confirmation-input.mjs';

const proposal = '## 2026-W40\n\n- 第一条\n  保留续行\n- 第二条\n\n';
test('逐项映射完整原文，保留标题与续行，并允许排除或修改', () => {
 const parts=parseMemoryProposal(proposal); let n=0; for (const p of parts) if(p.kind==='item') p.id=`memory-${++n}`;
 const entries=Object.fromEntries(parts.filter(p=>p.kind==='item').map(p=>[p.id,p.text]));
 assert.equal(reconstructApprovedMemory({parts,approved:entries}),proposal);
 assert.equal(reconstructApprovedMemory({parts,approved:{'memory-2':'- 修改第二条\n'}}),'## 2026-W40\n\n- 修改第二条\n\n');
 assert.throws(()=>parseMemoryProposal('## 标题\n\n无法唯一拆分的正文\n'),/ambiguous/);
 assert.throws(()=>reconstructApprovedMemory({parts,approved:{unknown:'- 未经展示\n'}}));
});

test('现有 Memory 指纹与全部具体收尾目标绑定后才生成逐项',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'learn-x-card-input-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'04_output/_dist/weekly/2026-W40'); await mkdir(dir,{recursive:true}); await mkdir(path.join(root,'04_output/weekly'),{recursive:true});
 await writeFile(path.join(root,'04_output/weekly/2026-40.md'),'# Learn-X Weekly Output｜2026-40\n\n## 11. 全文核心重点纪要\n真实总结\n\n## 12. 芒格之魂的洞察\n真实洞察\n');
 await prepareWeeklyMemory({week:'2026-W40',repoRoot:root}); await writeFile(path.join(dir,'memory-proposed.md'),proposal);
 const binding=await bindWeeklyMemoryApproval({week:'2026-W40',repoRoot:root}); const s=binding.scope;
 const closeoutEntries=[{id:'backup',action:`备份 ${s.backupRoots.join('、')} 并按既有规则清理留存`,destination:s.backupDestination},{id:'ywnext',action:'刷新索引',destination:s.ywnext},{id:'flomo',action:'同步周记和季度记忆',sources:s.flomo,destination:'Flomo/已验证账户/周记与季度记忆'}];
 const result=await buildLearnXConfirmationInputs({root,week:'2026-W40',fingerprint:binding.fingerprint,closeoutEntries});
 assert.deepEqual(result.items.map(x=>x.id),['memory-1','memory-2','closeout-backup','closeout-ywnext','closeout-flomo']);
 assert.equal(reconstructApprovedMemory({parts:result.parts,approved:Object.fromEntries(result.items.filter(x=>x.targets.includes('memory')).map(x=>[x.id,x.value]))}),proposal);
 const staged=await stageLearnXCard({root,week:'2026-W40',fingerprint:binding.fingerprint,closeoutEntries,selectedIds:['memory-2','closeout-backup'],edits:{'memory-2':'- 已修改\n'}});
 assert.equal(staged.staged,true); assert.notEqual(staged.fingerprint,binding.fingerprint); assert.deepEqual(staged.items.map(x=>x.id),['memory-1','closeout-backup']); assert.equal(staged.items[0].value,'- 已修改\n');
 await assert.rejects(buildLearnXConfirmationInputs({root,week:'2026-W40',fingerprint:binding.fingerprint,closeoutEntries}),/mismatch|stale/);
 const fresh=staged.fingerprint;
 await assert.rejects(buildLearnXConfirmationInputs({root,week:'2026-W40',fingerprint:fresh,closeoutEntries:closeoutEntries.slice(1)}),/incomplete/);
 await writeFile(path.join(dir,'memory-proposed.md'),proposal+'- 变更\n');
 await assert.rejects(buildLearnXConfirmationInputs({root,week:'2026-W40',fingerprint:fresh,closeoutEntries}),/stale/);
});

test('Flomo cannot be selected while its approved prerequisites are excluded', async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'learn-x-card-prereq-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'04_output/_dist/weekly/2026-W40'); await mkdir(dir,{recursive:true}); await mkdir(path.join(root,'04_output/weekly'),{recursive:true});
 await writeFile(path.join(root,'04_output/weekly/2026-40.md'),'# Learn-X Weekly Output｜2026-40\n\n## 11. 全文核心重点纪要\n真实总结\n\n## 12. 芒格之魂的洞察\n真实洞察\n');
 await prepareWeeklyMemory({week:'2026-W40',repoRoot:root}); await writeFile(path.join(dir,'memory-proposed.md'),proposal);
 const binding=await bindWeeklyMemoryApproval({week:'2026-W40',repoRoot:root}); const s=binding.scope;
 const closeoutEntries=[{id:'backup',action:`备份 ${s.backupRoots.join('、')} 并按既有规则清理留存`,destination:s.backupDestination},{id:'ywnext',action:'刷新索引',destination:s.ywnext},{id:'flomo',action:'同步周记和季度记忆',sources:s.flomo,destination:'Flomo/已验证账户/周记与季度记忆'}];
 await assert.rejects(stageLearnXCard({root,week:'2026-W40',fingerprint:binding.fingerprint,closeoutEntries,selectedIds:['closeout-flomo']}),/requires the selected backup and YW Next/);
});
