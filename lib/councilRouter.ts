import type {AiCouncilStage} from "@/lib/aiOrchestration";
import type {CouncilGeneration} from "@/lib/aiCouncil";
import {openRouterFreeGenerate} from "@/lib/openRouterFree";

export type CouncilRoute={stage:AiCouncilStage;policy:"free-only"|"existing-primary";provider:"openrouter-free"|"local-structural"|"existing-primary";fallback:boolean};
export function councilRouterStatus(){return {enabled:true,implementation:"native",helperPolicy:"free-only",synthesizerPolicy:"existing authorized primary and its existing model fallbacks",maxHelperAttempts:3,helperBudgetMs:35000,nestedCouncil:false,omniRouteInstalled:false,localFallback:"structural guidance, not independent semantic verification"};}

/** One Council owns the workflow; this router only selects a generation path. */
export async function routeCouncilStage(options:{stage:AiCouncilStage;prompt:string;withWeb:boolean;deadline:number;usedModels:readonly string[];primary:(prompt:string,web:boolean)=>Promise<CouncilGeneration>;local:()=>CouncilGeneration}):Promise<{generation:CouncilGeneration;route:CouncilRoute}>{
  if(options.stage==="synthesizer")return {generation:await options.primary(options.prompt,options.withWeb),route:{stage:options.stage,policy:"existing-primary",provider:"existing-primary",fallback:false}};
  try{
    if(Date.now()>=options.deadline)throw new Error("Helper budget exhausted");
    const generation=await openRouterFreeGenerate({prompt:options.prompt,stage:options.stage,avoidModels:options.usedModels,deadline:options.deadline,maxTokens:options.stage==="critic"?1200:900});
    return {generation,route:{stage:options.stage,policy:"free-only",provider:"openrouter-free",fallback:false}};
  }catch{
    return {generation:options.local(),route:{stage:options.stage,policy:"free-only",provider:"local-structural",fallback:true}};
  }
}
