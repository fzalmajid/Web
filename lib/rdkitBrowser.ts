let ready:Promise<any>|null=null;
export function loadRDKit(){
  if(typeof window==="undefined")throw new Error("RDKit memerlukan browser.");
  ready??=new Promise<void>((resolve,reject)=>{if((window as any).initRDKitModule){resolve();return;}const script=document.createElement("script");script.src="/learning-assets/RDKit_minimal.js";script.async=true;script.onload=()=>resolve();script.onerror=()=>{script.remove();reject(new Error("RDKit belum dapat dimuat."));};document.head.append(script);}).then(()=>{if(!(window as any).initRDKitModule)throw new Error("Runtime RDKit tidak tersedia.");return(window as any).initRDKitModule({locateFile:(file:string)=>"/learning-assets/"+file});}).catch(error=>{ready=null;throw error;});
  return ready;
}
