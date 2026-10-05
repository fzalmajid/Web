import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {observeVisualizationResize} from "../lib/visualizationResize";
test("visualization follows actual container changes and disconnects on unmount",()=>{
  const original=globalThis.ResizeObserver;
  let callback:any,observed:any,disconnected=false,resizes=0;
  globalThis.ResizeObserver=class {
    constructor(cb:any){callback=cb;}
    observe(host:any){observed=host;}
    unobserve(){}
    disconnect(){disconnected=true;}
  } as any;
  try {
    const host={} as Element;
    const stop=observeVisualizationResize(host,()=>resizes++);
    assert.equal(observed,host);
    callback([{contentRect:{width:826,height:360}}]);
    callback([{contentRect:{width:302,height:280}}]);
    callback([{contentRect:{width:0,height:0}}]);
    assert.equal(resizes,2);stop();assert.equal(disconnected,true);
  }finally{globalThis.ResizeObserver=original;}
});
test("unmounted containers do not create observers; all graphical tools use the shared resize contract",()=>{
  assert.doesNotThrow(()=>observeVisualizationResize(null,()=>{}));
  for(const file of ["DataLab","MoleculeLab","PaperExplorer"]){
    const source=readFileSync(`components/${file}.tsx`,"utf8");
    assert.match(source,/observeVisualizationResize\(.+\.current, \(\) => .+\.current\?\.resize\(\)/);
  }
});
