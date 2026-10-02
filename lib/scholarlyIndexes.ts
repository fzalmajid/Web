import { boundedJson } from "./publicResearch";
import type { ScholarlyHit } from "./scholarlySources";

export function scholarlyIndexStatus(){
  return {
    scopus:{configured:Boolean(process.env.SCOPUS_API_KEY?.trim()),optional:true,access:"official API; key and institutional entitlements/quotas apply; metadata is not full text"},
    sinta:{configured:false,mode:"official-directory-link",publicApi:"No documented official public API confirmed",automaticAccreditationClaims:false},
  };
}
export function scopusQuery(query:string){
  const terms=query.replace(/[^\p{L}\p{N}\s-]/gu," ").replace(/\s+/g," ").trim().slice(0,240);
  return terms?`TITLE-ABS-KEY(${terms})`:"";
}
export function mapScopusResults(payload:any):ScholarlyHit[]{
  const clean=(v:unknown)=>String(v||"").replace(/\s+/g," ").trim();
  return (Array.isArray(payload?.["search-results"]?.entry)?payload["search-results"].entry:[]).flatMap((entry:any)=>{
    const title=clean(entry["dc:title"]),doi=clean(entry["prism:doi"])||null;
    const uri=(entry.link||[]).find((link:any)=>link["@ref"]==="scopus")?.["@href"]||(doi?"https://doi.org/"+doi:"");
    if(!title||!/^https?:\/\//i.test(uri))return [];
    return [{provider:"scopus" as const,id:clean(entry.eid||entry["dc:identifier"]),title,doi,authors:entry["dc:creator"]?[clean(entry["dc:creator"])]:[],year:Number(clean(entry["prism:coverDate"]).slice(0,4))||null,journal:clean(entry["prism:publicationName"])||null,uri,pmid:null,pmcid:null,openAccess:Number(entry.openaccess)===1,volume:clean(entry["prism:volume"])||null,issue:clean(entry["prism:issueIdentifier"])||null,pages:clean(entry["prism:pageRange"])||null,indexedIn:["scopus"] as Array<"scopus">}];
  });
}
export async function searchScopus(query:string,limit=8){
  const key=process.env.SCOPUS_API_KEY?.trim();
  if(!key||!scopusQuery(query))return [];
  const url=new URL("https://api.elsevier.com/content/search/scopus");
  url.searchParams.set("query",scopusQuery(query));url.searchParams.set("view","STANDARD");url.searchParams.set("count",String(Math.min(12,Math.max(1,limit))));
  const token=process.env.SCOPUS_INST_TOKEN?.trim();
  // Credentials stay server-only headers, never URLs, prompts, responses, or public caches.
  const data=await boundedJson(url.href,{headers:{Accept:"application/json","X-ELS-APIKey":key,...(token?{"X-ELS-Insttoken":token}:{})},redirect:"error",cache:"no-store"});
  return mapScopusResults(data);
}
export function sintaDirectoryUrl(){return "https://sinta.kemdiktisaintek.go.id/journals";}
