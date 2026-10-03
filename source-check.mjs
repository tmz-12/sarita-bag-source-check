import {readFile,writeFile,appendFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {inspectCatalog,catalogUrls,mergeCandidates,watchScope} from './discovery.mjs';
import {cacheEvidence} from './freshness.mjs';
import {purchasePolicyVersion} from './purchase-evidence.mjs';
import {inspectSerialPurchases} from './purchase-navigation.mjs';
const root='https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/';
const browserHeadless=process.env.CHROME_HEADLESS!=='false';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:browserHeadless,args:['--no-sandbox']});
const sources=[],checks=[];
const previous=await readFile('latest.json','utf8').then(JSON.parse).catch(()=>({}));
async function waitForFrontend(page,response){
 if(!response?.ok())return false;
 try{await page.waitForNetworkIdle({idleTime:700,timeout:6000});return true}catch{return false}
}
try{
 for(const url of [root,...catalogUrls]){
  const page=await browser.newPage();
  try{
   let apiResponse;
   page.on('response',r=>{if(r.url().startsWith('https://bck.hermes.com/products?')&&new URL(r.url()).searchParams.get('locale')==='tw_zh'&&r.request().method()==='GET')apiResponse=r});
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
   const observedAt=new Date().toISOString();
   const renderWaitCompleted=await waitForFrontend(page,response);
   let headers=response?.headers()||{},method='github-browser-html',parsed=inspectCatalog(await page.content());
   let apiError=apiResponse&&!apiResponse.ok()?'官网前端商品接口 HTTP '+apiResponse.status():null;
   // Observe normal frontend requests only; no challenge solving or private cookies.
   if(apiResponse?.ok())try{
    const b=await apiResponse.json(),apiParsed=inspectCatalog('<script id="hermes-state">'+JSON.stringify({catalog:{u:'https://bck.hermes.com/products',s:200,b}})+'</script>');
    if(apiParsed.ok){parsed=apiParsed;headers=apiResponse.headers();method='github-browser-api'}else apiError=apiParsed.error;
   }catch{apiError='官网前端商品接口资料无法解析'}
   const cache=cacheEvidence(headers),valid=response?.status()===200&&page.url()===url;
   sources.push({url,observedAt,status:response?.status()||null,headers,method,renderWaitCompleted,apiStatus:apiResponse?.status()||null,apiError,...parsed,baselineCandidates:valid?parsed.candidates.map(p=>({...p,sourceUrl:url})):[],readable:valid&&parsed.ok,ok:valid&&parsed.ok&&cache.fresh,cacheAgeSeconds:cache.ageSeconds,cacheStatus:cache.cacheStatus,sourceDate:headers.date||null,error:!valid?'官网拒绝读取':parsed.error||(!cache.fresh?'分类资料有缓存或年龄无法确认，另须购买页面核验':null),candidates:valid?parsed.candidates.map(p=>({...p,sourceUrl:url,sourceDataAt:cache.dataAt,sourceCacheAgeSeconds:cache.ageSeconds,sourceFresh:cache.fresh})):[]});
  }catch(e){sources.push({url,method:'github-browser-html',ok:false,readable:false,complete:false,candidates:[],error:e.message})}finally{await page.close()}
 }
 const candidates=mergeCandidates(sources.flatMap(s=>s.candidates));
 // Every product notification requires a real page check. Keep old directory
 // signals from stopping a current PDP check; they may themselves be cached.
 const observations=Object.fromEntries(candidates.map(p=>[p.id,previous.purchaseObservations?.[p.id]||null]));
 const known=new Set((previous.candidates||[]).map(p=>p.id));
 const chosen=[...candidates].sort((a,b)=>(known.has(a.id)-known.has(b.id))||(Date.parse(observations[a.id]?.checkedAt||'')||0)-(Date.parse(observations[b.id]?.checkedAt||'')||0)).slice(0,24);
 const readerRequestPolicy=browserHeadless?'serial-browser-default-v1':'serial-browser-default-headed-v2';
 // First run of this policy probes the exact catalog-backed product shown by
 // the user. Later scans rotate oldest checks, with a bounded serial phase.
 const probe=previous.readerRequestPolicy!==readerRequestPolicy?chosen.find(p=>p.id==='H083939CP59'):null;
 const navigation=await inspectSerialPurchases(browser,probe?[probe]:chosen,{runId:process.env.GITHUB_RUN_ID||'manual',previousObservations:observations,budgetMs:45000});
 for(const p of candidates)if(navigation.results.has(p.id))Object.assign(p,navigation.results.get(p.id));
 checks.push(...navigation.checkedRows);Object.assign(observations,navigation.observations);
 const ok=sources.some(s=>s.url===root&&s.ok&&s.complete)||catalogUrls.every(url=>sources.some(s=>s.url===url&&s.ok&&s.complete));
 const output={schemaVersion:3,purchasePolicyVersion,readerRequestPolicy,purchaseNavigation:{mode:'browser-default',headless:browserHeadless,serial:true,budgetMs:45000,stopReason:navigation.stopReason,probeId:probe?.id||null},scope:watchScope,repository:'tmz-12/sarita-bag-source-check',runId:process.env.GITHUB_RUN_ID||null,checkedAt:new Date().toISOString(),method:'github-browser',ok,sources,candidates,checks,purchaseObservations:observations,notificationSent:false};
 // Publish only cache evidence; session cookies and authentication headers stay private.
 for(const s of sources)s.headers=Object.fromEntries(Object.entries(s.headers||{}).filter(([k])=>['age','date','cf-cache-status','cache-control'].includes(k)));
 for(const p of candidates)if(p.purchaseHeaders)p.purchaseHeaders=Object.fromEntries(Object.entries(p.purchaseHeaders).filter(([k])=>['age','date','cf-cache-status','cache-control'].includes(k)));
 await writeFile('latest.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output,null,2));
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Actual purchase checks\n\nReadable categories: ${sources.filter(s=>s.readable).length} / 3. Actual product-page checks: ${checks.length}.\n\nOnly fresh matching product pages with an enabled visible purchase button can qualify for notification. 403, unknown and cached purchase states cannot be sent.\n\nCloudflare rechecks the 120-second proof window at dispatch and consumes each proof at most once. No test notifications or purchases were made here.\n`);
}finally{await browser.close()}
