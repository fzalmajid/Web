import type { ScholarlyHit } from "./scholarlySources";
import type { CitationStyle } from "./citations";
import type { CitationIdentity } from "./answerEvidence";
import { formatVerifiedReference } from "./citationFormatterServer";
import { citationMetadataReady, REFERENCE_ENGINE_VERSION, type ReferenceMetadata } from "./referenceMetadata";

export function answerCitationInventory(hits:ScholarlyHit[],rows:any[],style:CitationStyle):CitationIdentity[]{
  const result:CitationIdentity[]=[];
  for(const row of rows){const metadata:ReferenceMetadata=row.bibliographic_metadata||{};if(!citationMetadataReady(metadata))continue;result.push({title:metadata.title!,doi:metadata.doi,uri:metadata.url||undefined,formatted:style!=="none"?formatVerifiedReference(metadata,style)||undefined:undefined});}
  for(const hit of hits){
    const source=hit.metadataBasis==="publisher"||hit.provider==="semanticscholar"||hit.provider==="scopus"?"official":hit.provider;
    const metadata:ReferenceMetadata={title:hit.title,authors:hit.authors,year:hit.year,type:hit.workType||"journal_article",container_title:hit.journal,doi:hit.doi,url:hit.uri,volume:hit.volume,issue:hit.issue,pages:hit.pages,
      audit:{engineVersion:REFERENCE_ENGINE_VERSION,checkedAt:new Date().toISOString(),status:"verified",basis:hit.metadataBasis==="publisher"?"document":"catalog",matches:[{source:hit.metadataBasis||hit.provider,similarity:1,method:hit.metadataBasis==="publisher"?"publisher identity matched":"retrieved catalog record"}],issues:[],missing:[],history:[]},provenance:{}};
    for(const key of Object.keys(metadata))if(key!=="audit"&&key!=="provenance")metadata.provenance![key]={source,confidence:0.95,note:"Retrieved public catalog metadata; does not verify claims in the paper."};
    result.push({title:hit.title,doi:hit.doi,uri:hit.uri,formatted:style!=="none"?formatVerifiedReference(metadata,style)||undefined:undefined});
  }
  return result;
}

export function publicCitationPrompt(inventory:CitationIdentity[]){return inventory.length?"\n\nIDENTITAS REFERENSI YANG TERSEDIA (bukan bukti bahwa setiap karya mendukung klaim; pilih hanya yang digunakan):\n"+inventory.map((item,i)=>`${i+1}. title=${item.title} | doi=${item.doi||"not available"} | url=${item.uri||"uploaded Database work"}\nCSL_EXACT=${item.formatted||"metadata only"}`).join("\n"):"\n\nINVENTARIS REFERENSI KOSONG. Jangan membuat daftar pustaka dari pengetahuan internal AI.";}
