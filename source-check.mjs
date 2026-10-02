import {writeFile,appendFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {inspectCatalog,catalogUrls} from './discovery.mjs';
import {cacheEvidence} from './freshness.mjs';

// No private tokens, notification topics, cookies or customer data are logged.
// This is a source diagnostic, not an inventory notification service.
const root='https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/';
const sitemap='https://www.hermes.com/tw/zh/sitemaps/products.xml';
const sources=[root,...catalogUrls,sitemap];
const output={checkedAt:new Date().toISOString(),environment:'github-standard-runner',http:[],browser:[],notificationSent:false};
for(const url of sources){
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(12000)}),body=await r.text(),cache=cacheEvidence(Object.fromEntries(r.headers));
  const data=url===sitemap?{readable:r.ok&&/^\s*(?:<\?xml[^>]*>\s*)?<urlset\b/.test(body),stockVerified:false}:inspectCatalog(body);
  output.http.push({url,status:r.status,cache,...data});
 }catch(e){output.http.push({url,error:e.message})}
}
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
 for(const url of sources.slice(0,3)){
  const page=await browser.newPage();
  try{
   const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
   const body=await page.content(),cache=cacheEvidence(r?.headers()||{}),data=inspectCatalog(body);
   output.browser.push({url,status:r?.status()||null,cache,...data,freshCatalog:r?.status()===200&&data.ok&&data.complete&&cache.fresh});
  }catch(e){output.browser.push({url,error:e.message})}finally{await page.close()}
 }
}finally{await browser.close()}
await writeFile('source-result.json',JSON.stringify(output,null,2));
const fresh=output.browser.some(s=>s.freshCatalog)||output.http.some(s=>s.status===200&&s.ok&&s.complete&&s.cache?.fresh);
console.log(JSON.stringify(output,null,2));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Actual source check\n\n${fresh?'Fresh catalog evidence found; stock and phone delivery still need verification.':'No verified fresh catalog source. This cannot be accepted as a working stock monitor.'}\n\nNo notifications or purchases were made. Detailed response evidence is in the job log.\n`);
// Evidence remains readable in logs; a failed source check is visibly failed.
if(!fresh)process.exitCode=2;
