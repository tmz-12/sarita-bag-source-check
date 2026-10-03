import {inspectPurchasePage} from './purchase-evidence.mjs';

export const purchasePhaseBudgetMs=45000;

export function choosePurchaseCandidates(candidates,{previousObservations={},knownIds,probeId,limit=6}={}){
 const known=knownIds?new Set(knownIds):null;
 const unique=[...new Map(candidates.map(p=>[p.id,p])).values()];
 const lastCheck=p=>Date.parse(previousObservations[p.id]?.checkedAt||'')||0;
 const count=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):unique.length;
 return unique.sort((a,b)=>(Number(b.id===probeId)-Number(a.id===probeId))||(known?Number(known.has(a.id))-Number(known.has(b.id)):0)||lastCheck(a)-lastCheck(b)).slice(0,count);
}

class PurchaseDeadlineError extends Error {}
async function withinBudget(work,remainingMs){
 let timer;
 try{
  return await Promise.race([
   Promise.resolve().then(work),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PurchaseDeadlineError('Purchase phase deadline reached')),remainingMs)}),
  ]);
 }finally{clearTimeout(timer)}
}

function withoutProof(product){
 const clean={...product};
 for(const key of Object.keys(clean))if(key.startsWith('purchase'))delete clean[key];
 return clean;
}
const failedCheck=(at,status='error')=>({purchaseVerified:false,purchaseVerification:status,purchaseHttpStatus:0,purchaseCheckedAt:new Date(at).toISOString()});

// This controls navigation only. The inspector and dispatch retain the same
// matching-SKU, visible-control and 120-second purchase-evidence policy.
export async function inspectSerialPurchases(browser,chosen,{runId='',source='github-browser',previousObservations={},inspector=inspectPurchasePage,budgetMs=purchasePhaseBudgetMs,stamp=Date.now,probeId}={}){
 const products=choosePurchaseCandidates(chosen,{previousObservations,probeId,limit:Infinity});
 const phaseMs=Number.isFinite(budgetMs)?Math.min(purchasePhaseBudgetMs,Math.max(0,budgetMs)):purchasePhaseBudgetMs;
 const deadlineAt=stamp()+phaseMs,results=new Map(),checkedRows=[],observations={...previousObservations};
 let page,openingPage,stopReason=null;
 try{
  if(!products.length)return {results,checkedRows,observations,stopReason};
  if(stamp()>=deadlineAt)stopReason='budget-exhausted';
  else{
   openingPage=Promise.resolve().then(()=>browser.newPage());
   try{page=await withinBudget(()=>openingPage,deadlineAt-stamp())}
   catch(error){stopReason=error instanceof PurchaseDeadlineError?'budget-exhausted':'browser-page-error'}
  }
  for(const product of products){
   if(stopReason)break;
   const remainingMs=deadlineAt-stamp();
   if(remainingMs<=0){stopReason='budget-exhausted';break}
   let proof;
   try{
    proof=await withinBudget(()=>inspector(browser,product,{source,runId,page,closePage:false,requestMode:'browser-default',timeoutMs:remainingMs}),remainingMs);
    if(stamp()>=deadlineAt)throw new PurchaseDeadlineError('Purchase phase deadline reached');
    if(!proof||typeof proof!=='object')proof=failedCheck(stamp());
   }catch(error){
    proof=failedCheck(stamp(),error instanceof PurchaseDeadlineError?'budget-exhausted':'error');
    if(error instanceof PurchaseDeadlineError)stopReason='budget-exhausted';
   }
   const result={...withoutProof(product),...proof};
   results.set(product.id,result);
   const row={id:product.id,url:product.url,status:result.purchaseVerification||'error',httpStatus:result.purchaseHttpStatus||null,checkedAt:result.purchaseCheckedAt||new Date(stamp()).toISOString()};
   checkedRows.push(row);observations[product.id]=row;
   if(proof.purchaseHttpStatus===403)stopReason='http-403';
   else if(proof.purchaseEvidence?.blocked===true||proof.blocked===true)stopReason='blocked';
  }
 }finally{
  if(page)await page.close().catch(()=>{});
  else if(openingPage)void openingPage.then(latePage=>latePage.close()).catch(()=>{});
 }
 for(const product of products)if(!results.has(product.id))results.set(product.id,{...withoutProof(product),purchaseVerified:false,purchaseVerification:'not-checked',purchaseCheckSkipReason:stopReason||'not-checked'});
 return {results,checkedRows,observations,stopReason};
}
