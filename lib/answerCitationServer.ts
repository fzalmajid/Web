import type { ScholarlyHit } from "./scholarlySources";
import type { CitationStyle } from "./citations";
import type { CitationIdentity } from "./answerEvidence";
import { formatVerifiedReference, referenceToCsl, metadataFromKnowledgeSource } from "./citationFormatterServer";
import { REFERENCE_ENGINE_VERSION, normalizeDoi, type ReferenceMetadata } from "./referenceMetadata";
import type { ScholarlyEvidence } from "./scholarlyFullText";
import { libraryCitationReady } from "./documentPolicy";
import { detectPrintedPageRange } from "./knowledge";

/** Reuse verified CSL name parsing (including surname-first initials/suffixes). */
export function citationAuthorYearKeys(metadata:ReferenceMetadata,trustedLibrary=false){
  const csl=referenceToCsl(metadata,trustedLibrary);
  const year=csl.issued?.["date-parts"]?.[0]?.[0];
  const authors=(csl.author||[]).map(name=>String(name?.family||name?.literal||"").trim()).filter(Boolean);
  if(!year)return [];
  const keys=authors.length===1?[`${authors[0]} ${year}`]:authors.length===2
    ?["&","and","dan"].map(joiner=>`${authors[0]} ${joiner} ${authors[1]} ${year}`)
    :authors.length?[`${authors[0]} et al ${year}`,`${authors[0]} dkk ${year}`]:[];
  if(authors.length>=3)for(const joiner of ["&","and","dan"]){
    keys.push(`${authors.slice(0,-1).join(", ")} ${joiner} ${authors[authors.length-1]} ${year}`);
  }
  // Aliases describe an already retrieved identity, never create a book/edition.
  // Collisions across works are rejected by omittedAuthorYearReferences.
  if(csl.type==="book"||csl.type==="chapter"){
    const title=csl.title||"";
    const aliases=[title];
    if(/farmakope herbal indonesia/i.test(title))aliases.push("FHI","Farmakope Herbal Indonesia");
    else if(/farmakope indonesia/i.test(title))aliases.push("FI","Farmakope Indonesia");
    if(/handbook of pharmaceutical excipients/i.test(title))aliases.push("HOPE","HPE");
    const organization=trustedLibrary||metadata.audit?.basis==="manual"||Boolean(metadata.provenance?.corporate_author&&metadata.provenance.corporate_author.confidence>=.9&&!["filename","mendeley"].includes(metadata.provenance.corporate_author.source))?metadata.corporate_author:"";
    if(organization){
      aliases.push(organization);
      if(/kementerian kesehatan/i.test(organization))aliases.push("Kemenkes","Kemenkes RI","Kementerian Kesehatan RI","Kementerian Kesehatan Republik Indonesia");
      if(/departemen kesehatan/i.test(organization))aliases.push("Depkes","Depkes RI","Departemen Kesehatan RI","Departemen Kesehatan Republik Indonesia");
    }
    const authorsVerified=trustedLibrary||metadata.audit?.basis==="manual"||Boolean(metadata.provenance?.authors&&metadata.provenance.authors.confidence>=.9&&!["filename","mendeley"].includes(metadata.provenance.authors.source));
    if(authorsVerified)for(const name of metadata.authors||[]){
      if(/kementerian kesehatan/i.test(name))aliases.push(name,"Kemenkes","Kemenkes RI","Kementerian Kesehatan RI","Kementerian Kesehatan Republik Indonesia");
      if(/departemen kesehatan/i.test(name))aliases.push(name,"Depkes","Depkes RI","Departemen Kesehatan RI","Departemen Kesehatan Republik Indonesia");
    }
    // Older Database titles can include the edition on the actual title itself.
    // Use that explicit label for matching only, never infer a missing edition.
    const edition=csl.edition||title.match(/\b(?:edisi|edition|ed\.?)\s+([IVXLCDM]+|\d+)\b/i)?.[1];
    const roman=["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
    const number=roman.indexOf(String(edition).toUpperCase())+1;
    const editions=edition?[...new Set([String(edition),...(number?[String(number)]:[]),...(roman[Number(edition)-1]?[roman[Number(edition)-1]]:[])])]:[];
    for(const alias of aliases.filter(Boolean)){
      keys.push(`${alias} ${year}`);
      for(const value of editions)keys.push(`${alias} ${value} ${year}`,`${alias} Edisi ${value} ${year}`);
    }
  }
  return [...new Set(keys)];
}

export function answerCitationInventory(hits:ScholarlyHit[],rows:any[],style:CitationStyle,evidence:ScholarlyEvidence[]=[]):CitationIdentity[]{
  const result:CitationIdentity[]=[];
  const libraryByWork=new Map<string,CitationIdentity>();
  for(const row of rows){
    const metadata:ReferenceMetadata=metadataFromKnowledgeSource(row);
    if(!libraryCitationReady(metadata))continue;
    const printed=row.printed_page_start?{start:String(row.printed_page_start),end:String(row.printed_page_end||row.printed_page_start)}:detectPrintedPageRange(String(row.raw_content||row.content||""));
    const pages=printed.start?[printed.end&&printed.end!==printed.start?`${printed.start}–${printed.end}`:String(printed.start)]:[];
    const workKey=String(row.bibliographic_work_id||row.source_file_id||metadata.isbn||`${metadata.title}|${metadata.edition||""}|${metadata.year||""}`);
    const existing=libraryByWork.get(workKey);
    if(existing){existing.printedPages=[...new Set([...(existing.printedPages||[]),...pages])];continue;}
    const keys=citationAuthorYearKeys(metadata,true);
    if(row.bibliographic_metadata?.title!==metadata.title&&row.bibliographic_metadata?.title&&metadata.year)keys.push(`${row.bibliographic_metadata.title} ${metadata.year}`);
    result.push({title:metadata.title!,doi:metadata.doi,uri:metadata.url||undefined,workType:metadata.type||undefined,year:metadata.year,printedPages:pages,authorYearKeys:keys,formatted:style!=="none"?formatVerifiedReference(metadata,style,true)||undefined:undefined});
    libraryByWork.set(workKey,result[result.length-1]);
  }
  for(const hit of hits){
    // A catalog identity cannot promote a known unresolved edition/year to a
    // formal reference. Preserve it in the source panel as a research lead.
    if(hit.publicationVersionConflict)continue;
    const source=hit.metadataBasis==="publisher"||hit.provider==="semanticscholar"||hit.provider==="scopus"?"official":hit.provider;
    const metadata:ReferenceMetadata={title:hit.title,authors:hit.authors,year:hit.year,type:hit.workType||"journal_article",container_title:hit.journal,doi:hit.doi,url:hit.uri,volume:hit.volume,issue:hit.issue,pages:hit.pages,
      audit:{engineVersion:REFERENCE_ENGINE_VERSION,checkedAt:new Date().toISOString(),status:"verified",basis:hit.metadataBasis==="publisher"?"document":"catalog",matches:[{source:hit.metadataBasis||hit.provider,similarity:1,method:hit.metadataBasis==="publisher"?"publisher identity matched":"retrieved catalog record"}],issues:[],missing:[],history:[]},provenance:{}};
    for(const key of Object.keys(metadata))if(key!=="audit"&&key!=="provenance")metadata.provenance![key]={source,confidence:0.95,note:"Retrieved public catalog metadata; does not verify claims in the paper."};
    const read=evidence.find(item=>hit.doi&&item.source.doi?hit.doi.toLowerCase()===item.source.doi.toLowerCase():hit.title===item.source.title);
    const pmcid=/^PMC\d+$/i.test(hit.pmcid||"")?hit.pmcid!.toUpperCase():null;
    const repositoryLinks=pmcid?[{label:"Artikel di PMC",uri:`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`},{label:"Artikel di Europe PMC",uri:`https://europepmc.org/articles/${pmcid}`}]:[];
    result.push({title:hit.title,doi:hit.doi,uri:hit.uri,workType:hit.workType||"journal_article",year:hit.year,authorYearKeys:citationAuthorYearKeys(metadata),formatted:style!=="none"?formatVerifiedReference(metadata,style)||undefined:undefined,catalogOnly:!read,readSource:read?{uri:read.uri,format:read.kind,pages:read.pages}:undefined,repositoryLinks});
  }
  // The same DOI can arrive from a private upload AND public retrieval.
  // Repeated records are one work, not an author/year ambiguity. Different
  // years/editions remain distinct; never merge by surname or title alone.
  const identities=new Map<string,CitationIdentity>();
  const deduplicated:CitationIdentity[]=[];
  for(const item of result){
    const doi=normalizeDoi(item.doi);
    const key=doi?`doi:${doi.toLowerCase()}|${item.year||""}`:"";
    const existing=key?identities.get(key):undefined;
    if(existing){
      existing.authorYearKeys=[...new Set([...(existing.authorYearKeys||[]),...(item.authorYearKeys||[])])];
      existing.printedPages=[...new Set([...(existing.printedPages||[]),...(item.printedPages||[])])];
      if(item.readSource)existing.readSource=item.readSource;
      existing.catalogOnly=Boolean(existing.catalogOnly&&item.catalogOnly);
      existing.uri||=item.uri;
    }else{deduplicated.push(item);if(key)identities.set(key,item);}
  }
  return deduplicated;
}

export function publicCitationPrompt(inventory:CitationIdentity[]){return inventory.length?"\n\nIDENTITAS REFERENSI YANG TERSEDIA (bukan bukti bahwa setiap karya mendukung klaim; pilih hanya yang digunakan):\n"+inventory.map((item,i)=>`${i+1}. title=${item.title} | doi=${item.doi||"not available"} | url=${item.uri||"uploaded Database work"}\nCSL_EXACT=${item.formatted||"metadata only"}`).join("\n"):"\n\nINVENTARIS REFERENSI KOSONG. Jangan membuat daftar pustaka dari pengetahuan internal AI.";}
