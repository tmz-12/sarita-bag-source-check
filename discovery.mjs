export const watchFamilies = ['Neo Garden Voyage 41', 'Evelyne', 'Picotin'];
export const catalogUrls = [
 'https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/',
 'https://www.hermes.com/tw/zh/category/leather-goods/bags-and-clutches/mens-bags-and-clutches/'
];
const normalizedName=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[‐‑‒–—−_]/g,'-').trim().toLowerCase();
const accessoryName=/strap|bandouliere|bag[\s-]*charm|key[\s-]*(?:ring|holder)|肩[帶带]|背[帶带]|吊[飾饰]|掛[飾饰]|挂饰|鑰匙圈|钥匙扣/;
function familyFromName(value){
 const name=normalizedName(value).replace(/^(?:hermes|愛馬仕|爱马仕)[\s-]*/,'');
 if(/^neo[\s-]*garden[\s-]*voyage[\s-]*41(?=$|[\s-]|手|包)/.test(name))return watchFamilies[0];
 if(/^evelyne(?=$|[\s-]|肩|包|\d|iii)/.test(name))return watchFamilies[1];
 if(/^picotin(?=$|[\s-]|手|包|lock|\d)/.test(name))return watchFamilies[2];
 return null;
}
export function candidateFromUrl(value,title='') {
 try {
  const u=new URL(value,'https://www.hermes.com');
  if(u.protocol!=='https:'||u.hostname!=='www.hermes.com'||u.port||u.username||u.password)return null;
  const path=decodeURIComponent(u.pathname);
  const match=path.match(/^\/tw\/zh\/product\/([^/]+)-(H[A-Z0-9]{8,14})\/$/i);
  if(!match)return null;
  const slug=normalizedName(match[1]);
  const urlFamily=familyFromName(slug),titleFamily=familyFromName(title);
  if(urlFamily&&titleFamily&&urlFamily!==titleFamily)return null;
  const neoSize=slug.match(/^neo[\s-]*garden[\s-]*voyage[\s-]*(\d+)/);
  if(neoSize&&Number(neoSize[1])!==41)return null;
  const family=urlFamily||titleFamily;
  if(!family)return null;
  // Exclude accessories whose names mention a bag family.
  if(accessoryName.test(slug+' '+normalizedName(title)))return null;
  u.search='';u.hash='';
  return {id:match[2].toUpperCase(),name:match[1].replaceAll('-',' '),color:'所有颜色 · 以商品页面为准',family,matchedBy:urlFamily?'url':'title',url:u.href,image:'',observation:'尚未核验'};
 }catch{return null}
}
export function discoverFromHtml(html) {
 const found=new Map();
 for(const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
  const p=candidateFromUrl(m[1].replaceAll('&amp;','&'));
  if(p)found.set(p.id,p);
 }
 return [...found.values()];
}
export function mergeCandidates(candidates){
 const found=new Map();
 const quality=p=>[p.sourceFresh?2:p.sourceDataAt?1:0,Date.parse(p.sourceDataAt||'')||0];
 for(const p of candidates){
  const prior=found.get(p.id),a=quality(p),b=prior?quality(prior):[-1,0];
  if(!prior||a[0]>b[0]||(a[0]===b[0]&&a[1]>b[1]))found.set(p.id,p);
 }
 return [...found.values()];
}
// Read the actual Angular transfer state, not CSS class names or a loading shell.
export function inspectCatalog(html) {
 const match=html.match(/<script\b[^>]*\bid=["']hermes-state["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!match)return {ok:false,complete:false,candidates:[],productCount:null,total:null,error:'缺少官网商品资料，不能把空壳网页视为零库存'};
 try{
  const state=JSON.parse(match[1]);
  const entry=Object.values(state).find(v=>v?.u==='https://bck.hermes.com/products');
  const data=entry?.b,items=data?.products?.items,total=data?.total;
  if(entry?.s!==200||!Array.isArray(items)||!Number.isInteger(total)||total<items.length||total<0)throw new Error('商品资料格式或数量不完整');
  const candidates=[];
  for(const item of items){
   if(typeof item.url!=='string'||!/^H[A-Z0-9]{8,14}$/.test(item.sku))throw new Error('商品编号或连结不完整');
   const p=candidateFromUrl(item.url.startsWith('/product/')?'/tw/zh'+item.url:item.url,item.title);
   if(p){
    if(p.id!==item.sku)throw new Error('商品编号与连结不一致');
    candidates.push({...p,name:item.title||p.name,color:item.avgColor||p.color,stockSignal:typeof item.stock?.ecom==='boolean'?item.stock.ecom:null,displayOnly:item.stock?.displayOnly===true});
   }
  }
  const complete=items.length===total;
  return {ok:true,complete,candidates,productCount:items.length,total,error:complete?null:'分类商品未全部载入，不能认定未出现的商品已下架'};
 }catch(e){return {ok:false,complete:false,candidates:[],productCount:null,total:null,error:'官网商品资料无法解析：'+e.message}}
}
export async function discoverCatalogs(fetcher=fetch) {
 const sources=await Promise.all(catalogUrls.map(async url=>{
  try{
   const r=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'follow',headers:{Accept:'text/html'},cache:'no-store'});
   if(!r.ok)return {url,status:r.status,ok:false,candidates:[],error:'官网分类页拒绝读取（HTTP '+r.status+'）'};
   const html=await r.text();
   const validUrl=r.url?.startsWith(url);
   const data=validUrl?inspectCatalog(html):{ok:false,complete:false,candidates:[],error:'分类页跳转到了其他页面'};
   return {url,status:r.status,bytes:html.length,...data};
  }catch{return {url,ok:false,candidates:[],error:'分类页读取失败或超时'}}
 }));
 return {checkedAt:new Date().toISOString(),ok:sources.every(s=>s.ok&&s.complete),sources,candidates:[...new Map(sources.flatMap(s=>s.candidates).map(p=>[p.id,p])).values()]};
}
