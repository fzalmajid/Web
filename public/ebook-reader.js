import { EPUB } from '/learning-assets/foliate/epub.js';
import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from '/learning-assets/foliate/vendor/zip.js';
configure({ useWebWorkers: false });
let book, reader, generation=0, chapter=0, navigation=0;
const host=document.getElementById('host');
const content=host.attachShadow({mode:'open'});
const status=document.getElementById('status'), toc=document.getElementById('toc');
const bookPolicy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; media-src blob:; font-src blob: data:; connect-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function sanitize(text,name){
  if(!/\.(x?html?|svg)$/i.test(name))return text;
  const xml=!/\.html?$/i.test(name),doc=new DOMParser().parseFromString(text,xml?'application/xml':'text/html');
  for(const el of [...doc.getElementsByTagName('*')]){
    if(['script','iframe','object','embed','form','base'].includes(el.localName.toLowerCase())){el.remove();continue;}
    for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||['srcdoc','formaction'].includes(attr.name.toLowerCase())||/^\s*(javascript|vbscript):/i.test(attr.value))el.removeAttribute(attr.name);
    if(el.localName==='meta'&&/refresh/i.test(el.getAttribute('http-equiv')||''))el.remove();
  }
  const head=doc.querySelector('head');if(head){const meta=doc.createElementNS(head.namespaceURI,'meta');meta.setAttribute('http-equiv','Content-Security-Policy');meta.setAttribute('content',bookPolicy);head.prepend(meta);}
  return xml?new XMLSerializer().serializeToString(doc):'<!doctype html>'+doc.documentElement.outerHTML;
}
async function showChapter(index,href=''){
  if(!book?.sections[index])return;
  const current=++navigation,id=generation;
  try{
    const section=book.sections[index],url=await section.load();
    const html=await (await fetch(url)).text();
    if(current!==navigation||id!==generation)return;
    const doc=new DOMParser().parseFromString(sanitize(html,'chapter.html'),'text/html');
    const style=document.createElement('style');style.textContent=':host{display:block}article{padding:20px;line-height:1.7;overflow-wrap:anywhere}img,svg{max-width:100%;height:auto}a{color:#287154}';
    const article=document.createElement('article');article.append(...Array.from(doc.body.childNodes,n=>document.importNode(n,true)));
    article.addEventListener('click',event=>{const link=event.target.closest?.('a');if(!link)return;event.preventDefault();const raw=link.getAttribute('href')||'';const target=book.resolveHref(section.resolveHref(raw));if(target)void showChapter(target.index,raw);});
    content.replaceChildren(style,article);chapter=index;
    const hash=href.split('#')[1];if(hash)content.getElementById(decodeURIComponent(hash))?.scrollIntoView();else window.scrollTo(0,0);
    const cfi=section.cfi;if(typeof cfi==='string')parent.postMessage({type:'rb-epub-progress',cfi},'*');
    document.getElementById('progress').textContent=`Bab ${index+1}/${book.sections.length}`;
    document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===book.sections.length-1;
    status.textContent='EPUB lokal. Script dan konten eksternal diblokir; bookmark menyimpan bab, bukan baris. File tidak diunggah.';
  }catch(e){if(current===navigation)status.textContent=e.message||'Bab tidak dapat dibuka.';}
}
document.getElementById('prev').onclick=()=>void showChapter(chapter-1);document.getElementById('next').onclick=()=>void showChapter(chapter+1);toc.onchange=()=>{const target=book?.resolveHref(toc.value);if(target)void showChapter(target.index,toc.value);};
addEventListener('message',async event=>{
  if(event.source!==parent||event.data?.type!=='rb-open-epub'||!(event.data.bytes instanceof ArrayBuffer))return;
  const id=++generation;status.textContent='Membuka buku lokal…';
  try{
    navigation++;book?.destroy();content.replaceChildren();await reader?.close();
    const blob=new Blob([event.data.bytes]);if(blob.size>20_000_000)throw Error('EPUB maksimal 20 MB.');
    reader=new ZipReader(new BlobReader(blob));const entries=await reader.getEntries();
    if(entries.length>2000||entries.some(e=>e.encrypted)||entries.reduce((s,e)=>s+e.uncompressedSize,0)>100_000_000)throw Error('Buku terenkripsi/DRM atau terlalu besar tidak didukung.');
    const map=new Map(entries.map(e=>[e.filename,e]));if(!map.has('META-INF/container.xml'))throw Error('File bukan EPUB valid.');
    const loader={loadText:async name=>{const e=map.get(name);return e?sanitize(await e.getData(new TextWriter()),name):null;},loadBlob:async(name,type)=>{const e=map.get(name);if(!e)return null;if(/\.(x?html?|svg)$/i.test(name))return new Blob([sanitize(await e.getData(new TextWriter()),name)],{type});return e.getData(new BlobWriter(type));},getSize:name=>map.get(name)?.uncompressedSize||0};
    book=await new EPUB(loader).init();if(id!==generation)return;
    toc.replaceChildren(new Option('Pilih bab',''));function add(items,depth=0){for(const item of items||[]){toc.add(new Option('—'.repeat(depth)+item.label,item.href));add(item.subitems,depth+1);}}add(book.toc);
    let start=0;if(event.data.cfi)try{start=book.resolveCFI(event.data.cfi)?.index||0;}catch{}
    await showChapter(start);
  }catch(e){if(id===generation)status.textContent=e.message||'Buku tidak dapat dibuka.';}
});
parent.postMessage({type:'rb-epub-ready'},'*');
