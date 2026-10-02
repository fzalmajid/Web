import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as pinnedFetch } from "undici";
export function isPublicAddress(address:string){
  if(isIP(address)===4){const [a,b]=address.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===198&&(b===18||b===19)));}
  return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:db8:/i.test(address);
}
export async function fetchPublicPage(raw:string, options: { maxBytes?: number; redirects?: number } = {}):Promise<{type:string;text:string;bytes:Buffer;url:string}>{
  const maxBytes=Math.max(1,Math.min(options.maxBytes||1_000_000,8_000_000));
  const url=new URL(raw);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("URL publik tidak valid.");
  const host=url.hostname.replace(/^\[|\]$/g,"");const records=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!records.length||records.some(row=>!isPublicAddress(row.address)))throw new Error("Alamat privat diblokir.");
  // Pin validated DNS addresses for this request; redirects cannot evade checks.
  const dispatcher=new Agent({connect:{lookup:((_:string,options:any,callback:any)=>{if(options?.all)callback(null,records);else callback(null,records[0].address,records[0].family);}) as any}});
  try{const response=await pinnedFetch(url,{dispatcher,redirect:"manual",signal:AbortSignal.timeout(10000),headers:{Accept:"text/html,text/plain,application/pdf,application/xml","User-Agent":"RuangBelajar/1.0"}});
    if([301,302,303,307,308].includes(response.status)){
      const target=response.headers.get("location");await response.body?.cancel();
      if(!target||(options.redirects||0)>=3)throw new Error("Redirect publik tidak tersedia.");
      return await fetchPublicPage(new URL(target,url).href,{...options,redirects:(options.redirects||0)+1});
    }
    if(!response.ok)throw new Error("Halaman tidak tersedia.");
    if(Number(response.headers.get("content-length"))>maxBytes)throw new Error("Halaman terlalu besar.");const reader=response.body?.getReader();if(!reader)throw new Error("Halaman kosong.");const parts:Uint8Array[]=[];let size=0;
    try{while(true){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>maxBytes)throw new Error("Halaman terlalu besar.");parts.push(row.value);}}finally{await reader.cancel().catch(()=>undefined);}
    const bytes=Buffer.concat(parts);return{type:response.headers.get("content-type")||"",text:bytes.toString("utf8"),bytes,url:url.href};
  }finally{await dispatcher.close();}
}
