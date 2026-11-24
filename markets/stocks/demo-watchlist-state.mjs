export function partitionPrivateWatchlistItems(items,catalog){
 const keys=new Set(catalog.map(item=>item.instrumentKey));
 const valid=Array.isArray(items)?items.filter(item=>typeof item?.instrument_key==="string"):[];
 return {visible:valid.filter(item=>keys.has(item.instrument_key)),preserved:valid.filter(item=>!keys.has(item.instrument_key))};
}
export function isCurrentWatchlistRequest(state,request){
 return !state.disposed&&request.requestSeq===state.requestSeq&&request.userId===state.userId&&
  request.listName===state.listName&&(request.editSeq===undefined||request.editSeq===state.editSeq);
}
export function mutatePrivateWatchlist(items,action,limit=50){
 const next=Array.isArray(items)?items.slice():[];
 if(!action||typeof action!=="object")return next;
 if(action.type==="add"){
  const key=action.item?.instrument_key;
  if(!key||next.some(item=>item.instrument_key===key)||next.length>=limit)return next;
  next.push(action.item);return next;
 }
 if(action.type==="remove"){
  return next.filter(item=>item.instrument_key!==action.instrumentKey);
 }
 if(action.type==="move"){
  const from=action.index,to=from+action.delta;
  if(!Number.isInteger(from)||!Number.isInteger(action.delta)||from<0||from>=next.length||to<0||to>=next.length)return next;
  [next[from],next[to]]=[next[to],next[from]];return next;
 }
 return next;
}
