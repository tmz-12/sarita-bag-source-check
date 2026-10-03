import {writeFile,appendFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {inspectCatalog,catalogUrls,mergeCandidates} from './discovery.mjs';
import {cacheEvidence} from './freshness.mjs';
import {classify} from './core.mjs';
const root='https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const sources=[],checks=[];
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
   const renderWaitCompleted=await waitForFrontend(page,response);
   let headers=response?.headers()||{},method='github-browser-html',parsed=inspectCatalog(await page.content());
   let apiError=apiResponse&&!apiResponse.ok()?'官网前端商品接口 HTTP '+apiResponse.status():null;
   // Observe normal frontend requests only; no challenge solving or private cookies.
   if(apiResponse?.ok())try{
    const b=await apiResponse.json(),apiParsed=inspectCatalog('<script id="hermes-state">'+JSON.stringify({catalog:{u:'https://bck.hermes.com/products',s:200,b}})+'</script>');
    if(apiParsed.ok){parsed=apiParsed;headers=apiResponse.headers();method='github-browser-api'}else apiError=apiParsed.error;
   }catch{apiError='官网前端商品接口资料无法解析'}
   const cache=cacheEvidence(headers),valid=response?.status()===200&&page.url()===url;
   sources.push({url,status:response?.status()||null,headers,method,renderWaitCompleted,apiStatus:apiResponse?.status()||null,apiError,...parsed,readable:valid&&parsed.ok,ok:valid&&parsed.ok&&cache.fresh,cacheAgeSeconds:cache.ageSeconds,cacheStatus:cache.cacheStatus,sourceDate:headers.date||null,error:!valid?'官网拒绝读取':parsed.error||(!cache.fresh?'分类资料有缓存或年龄无法确认，当前库存待确认':null),candidates:valid&&cache.usableLead?parsed.candidates.map(p=>({...p,sourceUrl:url,sourceDataAt:cache.dataAt,sourceCacheAgeSeconds:cache.ageSeconds,sourceFresh:cache.fresh})):[]});
  }catch(e){sources.push({url,method:'github-browser-html',ok:false,readable:false,complete:false,candidates:[],error:e.message})}finally{await page.close()}
 }
 const candidates=mergeCandidates(sources.flatMap(s=>s.candidates));
 for(const p of candidates.filter(p=>p.stockSignal!==false&&!p.displayOnly).slice(0,12)){
  const page=await browser.newPage();
  try{
   const r=await page.goto(p.url,{waitUntil:'domcontentloaded',timeout:8000});
   const renderWaitCompleted=await waitForFrontend(page,r);
   const evidence=await page.evaluate(()=>{
    const text=document.body.innerText;
    const buttons=Array.from(document.querySelectorAll('button')).filter(b=>b.textContent?.trim()==='加入購物車'&&!!(b.offsetWidth||b.offsetHeight||b.getClientRects().length));
    return {text,url:location.href,enabled:buttons.some(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true'),unavailable:text.includes('抱歉，所選商品缺貨'),blocked:/verify you are human|access denied|unusual traffic|captcha/i.test(text)};
   });
   const result=classify({...evidence,httpStatus:r?.status()||0},p.id),headers=r?.headers()||{};
   p.purchaseVerified=cacheEvidence(headers,Date.now(),300).fresh&&result.status==='available';
   p.purchaseCheckedAt=new Date().toISOString();p.purchaseVerification=result.status;p.purchaseHeaders=headers;p.purchaseHttpStatus=r?.status()||null;
   if(cacheEvidence(headers,Date.now(),300).fresh&&result.status==='unavailable')p.stockSignal=false;
   checks.push({id:p.id,status:p.purchaseHttpStatus,result:p.purchaseVerification,verified:p.purchaseVerified,renderWaitCompleted});
  }catch(e){p.purchaseVerified=false;p.purchaseVerification='error';checks.push({id:p.id,error:e.message})}finally{await page.close()}
 }
 const ok=sources.some(s=>s.url===root&&s.ok&&s.complete)||catalogUrls.every(url=>sources.some(s=>s.url===url&&s.ok&&s.complete));
 const output={schemaVersion:1,repository:'tmz-12/sarita-bag-source-check',runId:process.env.GITHUB_RUN_ID||null,checkedAt:new Date().toISOString(),method:'github-browser',ok,sources,candidates,checks,notificationSent:false};
 // Publish only cache evidence; session cookies and authentication headers stay private.
 for(const s of sources)s.headers=Object.fromEntries(Object.entries(s.headers||{}).filter(([k])=>['age','date','cf-cache-status','cache-control'].includes(k)));
 for(const p of candidates)if(p.purchaseHeaders)p.purchaseHeaders=Object.fromEntries(Object.entries(p.purchaseHeaders).filter(([k])=>['age','date','cf-cache-status','cache-control'].includes(k)));
 await writeFile('latest.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output,null,2));
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Actual listing scan\n\nReadable sources: ${sources.filter(s=>s.readable).length} / 3. Target links: ${candidates.length}.\n\n${ok?'Recent complete catalog evidence found.':'Current stock freshness not verified; only clearly labelled listing leads may be dispatched.'}\n\nCloudflare reads latest.json and owns dispatch and deduplication. No test notifications or purchases were made here.\n`);
}finally{await browser.close()}
