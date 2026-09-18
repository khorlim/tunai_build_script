import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {getLastTagMatchingPrefix} from '../node/lib/changelog/changelog-git.mjs';

test('production baseline includes non-ancestor tags after squash merging metadata',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tunai-squash-baseline-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(root,'code'),'base');git('add','.');git('commit','-m','base');
 git('tag','example-prod-v1.0.9+9');git('checkout','-b','candidate');
 fs.writeFileSync(path.join(root,'code'),'release');git('commit','-am','release');
 git('tag','example-prod-v1.0.10+10');git('checkout','-');
 assert.equal(await getLastTagMatchingPrefix(root,'example-prod'),'example-prod-v1.0.9+9');
 assert.equal(await getLastTagMatchingPrefix(root,'example-prod',{reachableOnly:false}),'example-prod-v1.0.10+10');
});
