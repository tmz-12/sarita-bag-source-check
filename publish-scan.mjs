import {execFileSync} from 'node:child_process';
import {readFile,appendFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';

// Publish only the actual result onto the current remote tree. Do not merge
// old source code or force-push when a deployment/another result moved main.
const result=await readFile('latest.json','utf8'),scan=JSON.parse(result);
if(scan.schemaVersion!==3||scan.purchasePolicyVersion!==1||scan.repository!=='tmz-12/sarita-bag-source-check'||!Number.isFinite(Date.parse(scan.checkedAt)))throw new Error('Actual scan metadata is invalid');
const sourcePaths=['source-check.mjs','purchase-evidence.mjs','purchase-navigation.mjs','freshness.mjs','discovery.mjs','core.mjs'];
const index=resolve(process.env.RUNNER_TEMP||'.git','sarita-publish-'+(process.env.GITHUB_RUN_ID||process.pid)+'.index');
const git=(args,options={})=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
async function note(message){console.log(message);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'\n'+message+'\n')}
let published=false;
try{
 for(let attempt=1;attempt<=3;attempt++){
  git(['fetch','--no-tags','origin','main']);
  if(git(['diff','HEAD','origin/main','--',...sourcePaths]).trim()){
   await note('Scan result was not published because the reader was updated while this job ran. The next cloud scan will use the new reader.');published=true;break;
  }
  const parent=git(['rev-parse','origin/main']).trim();
  let remote;
  try{remote=JSON.parse(git(['show',parent+':latest.json']))}catch{}
  if(remote&&Date.parse(remote.checkedAt)>=Date.parse(scan.checkedAt)){
   await note('A newer actual scan is already published; this older result was skipped.');published=true;break;
  }
  const env={...process.env,GIT_INDEX_FILE:index};
  git(['read-tree',parent],{env});
  const blob=git(['hash-object','-w','--stdin'],{input:result}).trim();
  git(['update-index','--add','--cacheinfo','100644,'+blob+',latest.json'],{env});
  const tree=git(['write-tree'],{env}).trim();
  const commit=git(['-c','user.name=sarita-monitor','-c','user.email=sarita-monitor@users.noreply.github.com','commit-tree',tree,'-p',parent,'-m','Record actual listing scan'],{env}).trim();
  try{
   git(['push','origin',commit+':refs/heads/main']);
   await note('Actual scan '+(scan.runId||'')+' published on current main after '+attempt+' attempt(s).');published=true;break;
  }catch(error){
   // Re-read the remote branch on a concurrent update; never force a push.
   if(attempt===3)throw error;
   console.log('Publish was rejected; refreshing current main before retry '+(attempt+1)+'.');
  }
 }
 if(!published)throw new Error('Actual scan was not published');
}finally{await rm(index,{force:true});await rm(index+'.lock',{force:true})}
