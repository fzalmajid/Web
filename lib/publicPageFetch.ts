import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as pinnedFetch } from "undici";
export function isPublicAddress(address:string){
  if(isIP(address)===4){const [a,b]=address.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===198&&(b===18||b===19)));}
  return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:db8:/i.test(address);
}
export async function fetchPublicPage(raw:string){
  const url=new URL(raw);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("URL publik tidak valid.");
  const host=url.hostname.replace(/^\[|\]$/g,"");const records=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!records.length||records.some(row=>!isPublicAddress(row.address)))throw new Error("Alamat privat diblokir.");
  // Pin validated DNS addresses for this request; redirects cannot evade checks.
  const dispatcher=new Agent({connect:{lookup:((_:string,options:any,callback:any)=>{if(options?.all)callback(null,records);else callback(null,records[0].address,records[0].family);}) as any}});
  try{const response=await pinnedFetch(url,{dispatcher,redirect:"error",signal:AbortSignal.timeout(10000),headers:{Accept:"text/html,text/plain","User-Agent":"RuangBelajar/1.0"}});if(!response.ok)throw new Error("Halaman tidak tersedia.");
    if(Number(response.headers.get("content-length"))>1_000_000)throw new Error("Halaman terlalu besar.");const reader=response.body?.getReader();if(!reader)throw new Error("Halaman kosong.");const parts:Uint8Array[]=[];let size=0;
    try{while(true){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>1_000_000)throw new Error("Halaman terlalu besar.");parts.push(row.value);}}finally{await reader.cancel().catch(()=>undefined);}
    return{type:response.headers.get("content-type")||"",text:Buffer.concat(parts).toString("utf8")};
  }finally{await dispatcher.close();}
}
