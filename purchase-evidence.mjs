import {catalogCandidateFromUrl} from './discovery.mjs';
import {cacheEvidence} from './freshness.mjs';
export const purchasePolicyVersion=1;
export const purchaseEvidenceMaxSeconds=120;
const publicHeaders=headers=>Object.fromEntries(Object.entries(headers||{}).filter(([k])=>['age','date','cf-cache-status','cache-control'].includes(k)));
function purchaseCacheFresh(headers,stamp){
 const date=Date.parse(headers.date||'');
 // The classification cache helper allows clock grace; purchase proof does not
 // get an extra age allowance. Both Date and effective Age must fit 120s.
 return Number.isFinite(date)&&date<=stamp+5000&&stamp-date<purchaseEvidenceMaxSeconds*1000&&cacheEvidence(headers,stamp,purchaseEvidenceMaxSeconds).fresh;
}
function matches(product,url,id){
 try{const p=catalogCandidateFromUrl(url,product.name);return p?.id===product.id&&id===product.id&&p.url===product.url}catch{return false}
}
export function purchaseProof(product,evidence,{stamp=Date.now(),source='cloud-browser',runId=''}={}){
 const observed=Date.parse(evidence.observedAt||''),checkedAt=new Date(stamp).toISOString();
 const base={purchasePolicyVersion,purchaseProductId:product.id,purchaseUrl:evidence.url,purchaseObservedAt:evidence.observedAt,purchaseCheckedAt:checkedAt,purchaseHttpStatus:evidence.httpStatus||0,purchaseHeaders:publicHeaders(evidence.headers),purchaseEvidence:{skuConfirmed:evidence.skuConfirmed===true,enabled:evidence.enabled===true,unavailable:evidence.unavailable===true,blocked:evidence.blocked===true},purchaseProofId:source+':'+runId+':'+product.id+':'+checkedAt};
 const valid=matches(product,evidence.url,product.id)&&evidence.httpStatus===200&&evidence.skuConfirmed===true&&!evidence.blocked;
 const headers={...base.purchaseHeaders};if(headers.age!==undefined&&String(headers.age).trim()!==''&&Number(headers.age)>=0)headers.age=String(Number(headers.age)+Math.max(0,(stamp-observed)/1000));
 const fresh=valid&&Number.isFinite(observed)&&stamp-observed>=0&&stamp-observed<purchaseEvidenceMaxSeconds*1000&&purchaseCacheFresh(headers,stamp);
 const status=fresh?(evidence.unavailable&&!evidence.enabled?'unavailable':evidence.enabled&&!evidence.unavailable?'available':'error'):valid?'cached-or-unknown':'error';
 return {...base,purchaseVerification:status,purchaseVerified:status==='available'};
}
export function purchaseEvidenceStatus(product,stamp=Date.now()){
 const elapsed=stamp-Date.parse(product.purchaseCheckedAt||''),observed=Date.parse(product.purchaseObservedAt||'');
 if(product.purchasePolicyVersion!==purchasePolicyVersion||!product.purchaseProofId||!matches(product,product.purchaseUrl,product.purchaseProductId)||product.purchaseHttpStatus!==200||!Number.isFinite(elapsed)||elapsed<0||elapsed>=purchaseEvidenceMaxSeconds*1000||!Number.isFinite(observed)||stamp-observed<0||stamp-observed>=purchaseEvidenceMaxSeconds*1000||observed>Date.parse(product.purchaseCheckedAt))return null;
 const e=product.purchaseEvidence;
 if(e?.skuConfirmed!==true||e.blocked!==false||e.enabled===e.unavailable)return null;
 const headers={...product.purchaseHeaders};if(headers.age!==undefined&&String(headers.age).trim()!==''&&Number(headers.age)>=0)headers.age=String(Number(headers.age)+Math.max(0,(stamp-observed)/1000));
 if(!purchaseCacheFresh(headers,stamp))return null;
 return e.enabled===true&&e.unavailable===false&&product.purchaseVerification==='available'?'available':e.enabled===false&&e.unavailable===true&&product.purchaseVerification==='unavailable'?'unavailable':null;
}
export const hasFreshPurchaseEvidence=(product,stamp=Date.now())=>product.purchaseVerified===true&&purchaseEvidenceStatus(product,stamp)==='available';
export function purchaseDomEvidence(id){
 const text=document.body.innerText;
 const visible=b=>{
  const rect=b.getBoundingClientRect();if(!rect.width||!rect.height)return false;
  for(let node=b;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||style.pointerEvents==='none'||node.hidden)return false}
  const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
  if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
  const hit=document.elementFromPoint(x,y);return hit===b||b.contains(hit);
 };
 const buttons=Array.from(document.querySelectorAll('button')).filter(b=>b.textContent?.trim()==='加入購物車'&&visible(b));
 return {url:location.href,skuConfirmed:text.includes(id),enabled:buttons.some(b=>!b.disabled&&!b.matches(':disabled')&&b.getAttribute('aria-disabled')!=='true'&&!b.closest('[inert],[aria-disabled="true"]')),unavailable:/抱歉，所選商品缺貨|所選商品缺貨|此商品暫時缺貨/.test(text),blocked:/verify you are human|verifying the device|access denied|unusual traffic|captcha|Sorry, you have been blocked/i.test(text)||!!document.querySelector('iframe[id^="ddChallenge"],iframe[src*="captcha-delivery"]')};
}
export async function inspectPurchasePage(browser,product,{source='cloud-browser',runId=''}={}){
 let page;
 try{
  page=await browser.newPage();await page.setCacheEnabled(false);await page.setExtraHTTPHeaders({'Cache-Control':'no-cache, max-age=0','Pragma':'no-cache'});
  const response=await page.goto(product.url,{waitUntil:'domcontentloaded',timeout:10000}),observedAt=new Date().toISOString();
  if(response?.status()===200)await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='加入購物車'),{timeout:3000}).catch(()=>{});
  if(response?.status()===200)await page.evaluate(()=>{
   const controls=Array.from(document.querySelectorAll('button')).filter(b=>{
    if(b.textContent?.trim()!=='加入購物車')return false;
    const rect=b.getBoundingClientRect();if(!rect.width||!rect.height)return false;
    for(let node=b;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||style.pointerEvents==='none'||node.hidden)return false}
    return true;
   });
   const enabled=controls.find(b=>!b.disabled&&!b.matches(':disabled')&&b.getAttribute('aria-disabled')!=='true'&&!b.closest('[inert],[aria-disabled="true"]'));
   (enabled||controls[0])?.scrollIntoView({block:'center'});
  });
  const evidence=await page.evaluate(purchaseDomEvidence,product.id);
  return purchaseProof(product,{...evidence,httpStatus:response?.status()||0,headers:response?.headers()||{},observedAt},{source,runId});
 }catch{return {purchasePolicyVersion,purchaseVerified:false,purchaseVerification:'error',purchaseCheckedAt:new Date().toISOString(),purchaseProductId:product.id}}
 finally{await page?.close().catch(()=>{})}
}
