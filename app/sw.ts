/// <reference lib="webworker" />
import { Serwist, NetworkFirst, CacheFirst, type PrecacheEntry } from "serwist";
declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry|string)[]|undefined };
const sw=new Serwist({precacheEntries:self.__SW_MANIFEST,skipWaiting:true,clientsClaim:true,runtimeCaching:[
  {matcher:({url,request})=>url.origin===self.location.origin&&request.mode==="navigate"&&url.pathname==="/offline",handler:new NetworkFirst({cacheName:"rb-offline-shell"})},
  {matcher:({url})=>url.origin===self.location.origin&&url.pathname.startsWith("/_next/static/")&&/\.(js|css|woff2?)$/.test(url.pathname),handler:new CacheFirst({cacheName:"rb-public-static"})},
]});
sw.addEventListeners();
