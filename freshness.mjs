export function cacheEvidence(headers,stamp=Date.now(),limitSeconds=900){
 const reportedAge=headers.age===undefined?null:Number(headers.age);
 const date=Date.parse(headers.date||'');
 // Keep the source time fixed when the same response is relayed again.
 const age=reportedAge===null?null:Math.max(reportedAge,Number.isFinite(date)?Math.max(0,(stamp-date)/1000):0);
 const status=(headers['cf-cache-status']||'').toUpperCase();
 const ageValid=reportedAge===null||(String(headers.age).trim()!==''&&Number.isFinite(reportedAge)&&reportedAge>=0);
 const uncached=/^(MISS|DYNAMIC|BYPASS)$/.test(status)||/no-store|no-cache|max-age=0(?:,|$)/i.test(headers['cache-control']||'');
 const fresh=ageValid&&(!Number.isFinite(date)||date<=stamp+120000)&&(age!==null?age<limitSeconds:uncached&&Number.isFinite(date)&&Math.abs(stamp-date)<(limitSeconds+120)*1000);
 return {fresh,ageSeconds:age,cacheStatus:status||null,dataAt:ageValid&&Number.isFinite(date)&&(age!==null||uncached)?new Date(age===null?date:stamp-age*1000).toISOString():null,usableLead:ageValid&&(age===null||age<3600)};
}
