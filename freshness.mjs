export function cacheEvidence(headers,stamp=Date.now(),limitSeconds=900){
 const age=headers.age===undefined?null:Number(headers.age);
 const date=Date.parse(headers.date||'');
 const status=(headers['cf-cache-status']||'').toUpperCase();
 const ageValid=age===null||(Number.isFinite(age)&&age>=0);
 const uncached=/^(MISS|DYNAMIC|BYPASS)$/.test(status)||/no-store|no-cache|max-age=0(?:,|$)/i.test(headers['cache-control']||'');
 const fresh=ageValid&&(age!==null?age<limitSeconds:uncached&&Number.isFinite(date)&&Math.abs(stamp-date)<(limitSeconds+120)*1000);
 return {fresh,ageSeconds:age,cacheStatus:status||null,dataAt:Number.isFinite(date)&&(age!==null||uncached)?new Date(date-(age||0)*1000).toISOString():null,usableLead:ageValid&&(age===null||age<3600)};
}
