import test from "node:test";
import assert from "node:assert/strict";
import {referenceSubtreeIds,toggleReferenceFolder} from "../lib/referenceSelection";
const nodes=[{id:"parent",parent_id:null},{id:"child",parent_id:"parent"},{id:"grandchild",parent_id:"child"},{id:"other",parent_id:null}];
const files=[{id:"book",node_id:"grandchild"},{id:"paper",node_id:"other"}];
test("folder selection covers all descendants, keeps unrelated selections, and compacts roots",()=>{
  const result=toggleReferenceFolder(nodes,files,{nodeIds:["child","other"],fileIds:["book","paper"]},"parent");
  assert.deepEqual(result,{nodeIds:["other","parent"],fileIds:["paper"]});
  assert.deepEqual(referenceSubtreeIds(nodes,"parent"),["parent","child","grandchild"]);
  assert.strictEqual(toggleReferenceFolder(nodes,files,result,"child"),result);
  assert.deepEqual(toggleReferenceFolder(nodes,files,result,"parent"),{nodeIds:["other"],fileIds:["paper"]});
});
test("reference traversal terminates on cycles without crossing unrelated roots",()=>{
  assert.deepEqual(referenceSubtreeIds([{id:"a",parent_id:"b"},{id:"b",parent_id:"a"},...nodes],"a"),["a","b"]);
});
