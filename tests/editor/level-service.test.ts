import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLevelEditorServer } from '../../scripts/board-editor/serve.mjs';
import { compileThemeCsv, renderThemeData } from '../../scripts/compileThemeCsv.mjs';

test('isolated HTTP editor serves all browser modules and requires reviewed confirmation for sandbox-only import', async () => {
  const port = 17469, value = await createLevelEditorServer(port);
  await new Promise<void>((resolve, reject) => { value.server.once('error', reject); value.server.listen(port, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${port}`;
  const post = async (path: string, body: unknown, origin = base) => fetch(`${base}${path}`, {method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  try {
    for (const route of ['/', '/editor.js','/core.js','/groupsCore.js','/groupsEditor.js','/groupsView.js','/playtest.js','/assets/Colony/scripts/gameModel.js','/assets/Colony/scripts/application/boardRoute','/assets/Colony/scripts/application/levelCatalog','/assets/Colony/scripts/application/levelCatalog.js','/examples/first-level-draft.json']) assert.equal((await fetch(base+route)).status,200,route);
    assert.match(await (await fetch(base+'/editor.js')).text(),/mountGroupsEditor/);
    assert.equal((await fetch(base+'/levelPipeline.js')).status,404);
    assert.equal((await post('/api/level/preview',{},'https://untrusted.example')).status,403);
    assert.equal((await post('/api/level/preview',{root:'D:/code/shidai3/P4000/ant-cook'})).status,400);
    const response=await post('/api/level/preview',{level:7,board:{schema:'colony-board-v1',rows:1,columns:3,boardCells:'ABC'},
      rules:{schema:'colony-level-rules-v2',queueColumns:3,cellOrder:'0.0|0.1|0.2',groups:'A:1:0:0|B:1:1:0|C:1:2:0',selectionOrder:[],groupRules:{'0':{linkId:'pair'},'1':{linkId:'pair',mystery:true},'2':{lockId:'door'}},cellKeys:{'0.0':'door'}}});
    const candidate=await response.json() as {error?:string;id:string;confirmation:string;sandbox:string;outputRoot:string;validation:{status:string};selectionOrder:number[]};
    assert.equal(response.status,200,candidate.error);assert.equal(candidate.validation.status,'WITNESS_PASS_STABLE_BATCH');assert.equal(candidate.selectionOrder.length,3);
    assert.ok(candidate.sandbox.startsWith(value.work));assert.ok(candidate.outputRoot.startsWith(value.work));
    assert.equal((await post('/api/level/apply',{id:candidate.id,confirmation:'unreviewed'})).status,400);
    const applied=await post('/api/level/apply',{id:candidate.id,confirmation:candidate.confirmation});assert.equal(applied.status,200);
    assert.equal((await post('/api/level/apply',{id:candidate.id,confirmation:candidate.confirmation})).status,400);
    const data=compileThemeCsv({inputRoot:join(candidate.sandbox,'assets/Colony/config/themes')});
    assert.equal(readFileSync(join(candidate.sandbox,'assets/Colony/scripts/application/operationalThemeData.ts'),'utf8'),renderThemeData(data));assert.equal(data.levels[6]!.queueColumns,3);
  } finally { await new Promise<void>((resolve,reject)=>value.server.close(error=>error?reject(error):resolve())); }
});
