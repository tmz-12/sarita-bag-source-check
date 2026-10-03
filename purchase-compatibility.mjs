import {writeFile,appendFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {inspectCatalog} from './discovery.mjs';
import {purchaseDomEvidence} from './purchase-evidence.mjs';

// One read-only comparison of normal category -> product navigation. This
// never publishes a production scan or sends a notification.
const root='https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/';
const sku='H083939CP59';
const publicHeaders=headers=>Object.fromEntries(Object.entries(headers).filter(([key])=>['age','date','cf-cache-status','cache-control'].includes(key)));
const fields=new Set(['product','products','item','items','variants','variant','sku','stock','availableCtas','ecom','retail','hasVariantInEcomStock','displayOnly','type','enabled','title','url','id','secondId','locale','selectedVariant']);
function publicProductFields(value,depth=0){
 if(depth>8)return null;
 if(Array.isArray(value))return value.slice(0,80).map(item=>publicProductFields(item,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>fields.has(key)).map(([key,item])=>[key,publicProductFields(item,depth+1)]));
 return typeof value==='string'?value.slice(0,300):value;
}
const report={runId:process.env.GITHUB_RUN_ID||null,runnerOS:process.platform,checkedAt:null,sources:[],checks:[],candidates:[],frontendResponses:[],resourceFailures:[],purchaseNavigation:{mode:'ordinary-category-link',serial:true,probeId:sku}};
let browser,page;
const pending=[];
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:false});
 report.browserVersion=await browser.version();
 page=await browser.newPage();
 page.on('requestfailed',request=>{
  try{const url=new URL(request.url());if(report.resourceFailures.length<12)report.resourceFailures.push({origin:url.origin,path:url.pathname,type:request.resourceType(),error:request.failure()?.errorText})}catch{}
 });
 page.on('response',response=>{
  try{
   const url=new URL(response.url());
   if(url.origin!=='https://bck.hermes.com'||!url.pathname.startsWith('/product')||response.request().method()!=='GET'||report.frontendResponses.length>=10)return;
   const row={path:url.pathname,status:response.status(),observedAt:new Date().toISOString(),headers:publicHeaders(response.headers())};
   report.frontendResponses.push(row);
   if(response.ok())pending.push(response.json().then(body=>{row.rootKeys=Object.keys(body);row.publicProduct=publicProductFields(body)}).catch(()=>{row.parseError=true}));
  }catch{}
 });
 const response=await page.goto(root,{waitUntil:'domcontentloaded',timeout:15000});
 await page.waitForNetworkIdle({idleTime:700,timeout:6000}).catch(()=>{});
 report.sources.push({url:root,status:response?.status(),headers:publicHeaders(response?.headers()||{})});
 if(response?.status()!==200)throw new Error('Category refused; no further request');
 const product=inspectCatalog(await page.content()).candidates.find(item=>item.id===sku);
 if(!product)throw new Error('Reported SKU is absent from actual catalog');
 const href=await page.evaluate(url=>Array.from(document.querySelectorAll('a[href]')).find(link=>link.href===url)?.getAttribute('href'),product.url);
 if(!href)throw new Error('No actual product link is present to follow');
 await page.click('a[href='+JSON.stringify(href)+']');
 await page.waitForFunction(id=>location.pathname.includes(id)&&document.body.innerText.includes(id),{timeout:10000},sku).catch(()=>{});
 await page.waitForNetworkIdle({idleTime:700,timeout:6000}).catch(()=>{});
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent?.trim()==='加入購物車')?.scrollIntoView({block:'center',behavior:'instant'}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const evidence=await page.evaluate(purchaseDomEvidence,sku);
 await Promise.allSettled(pending);
 report.candidates.push({...product,diagnosticEvidence:evidence});
 report.checks.push({id:sku,url:page.url(),skuConfirmed:evidence.skuConfirmed,enabled:evidence.enabled,blocked:evidence.blocked});
}catch(error){report.error=error.message}
finally{
 await page?.close().catch(()=>{});await browser?.close().catch(()=>{});
 report.checkedAt=new Date().toISOString();
 await writeFile('latest.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## Ordinary Edge category link navigation\n\n```json\n'+JSON.stringify(report,null,2)+'\n```\n');
}
