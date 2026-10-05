export type ReferenceSelection = {nodeIds:string[];fileIds:string[]};
type Node = {id:string;parent_id:string|null};
type File = {id:string;node_id:string};

/** Selecting a folder represents its full subtree; cycles never broaden scope. */
export function referenceSubtreeIds(nodes:Node[],root:string) {
  const result=[root],seen=new Set(result);
  for(let i=0;i<result.length;i++) for(const node of nodes) {
    if(node.parent_id===result[i]&&!seen.has(node.id)){seen.add(node.id);result.push(node.id);}
  }
  return result;
}
export function toggleReferenceFolder(nodes:Node[],files:File[],selection:ReferenceSelection,id:string):ReferenceSelection {
  if(selection.nodeIds.some(root=>root!==id&&referenceSubtreeIds(nodes,root).includes(id)))return selection;
  const subtree=new Set(referenceSubtreeIds(nodes,id));
  const nodeIds=selection.nodeIds.filter(root=>!subtree.has(root));
  if(!selection.nodeIds.includes(id))nodeIds.push(id);
  const fileIds=selection.fileIds.filter(fileId=>{const file=files.find(item=>item.id===fileId);return !file||!subtree.has(file.node_id);});
  return {nodeIds,fileIds};
}
