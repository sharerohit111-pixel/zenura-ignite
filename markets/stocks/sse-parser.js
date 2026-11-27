"use strict";
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 if(root)root.ZenuraSseParser=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 const MAX_BUFFER=1024*1024;
 function parseSseChunk(buffer,chunk,{final=false,maxBuffer=MAX_BUFFER}={}){
  if(typeof buffer!=="string"||typeof chunk!=="string")throw new TypeError("SSE buffer and chunk must be strings");
  if(!Number.isSafeInteger(maxBuffer)||maxBuffer<1)throw new RangeError("Invalid SSE buffer limit");
  let pending=buffer+chunk;
  if(pending.length>maxBuffer)throw new RangeError("SSE event buffer limit exceeded");
  const events=[];
  const boundary=/\r\n\r\n|\n\n|\r\r/g;
  let match,last=0;
  while((match=boundary.exec(pending))){
   const block=pending.slice(last,match.index);last=boundary.lastIndex;
   const parsed=parseBlock(block);if(parsed)events.push(parsed);
  }
  pending=pending.slice(last);
  if(final&&pending){const parsed=parseBlock(pending);if(parsed)events.push(parsed);pending="";}
  if(pending.length>maxBuffer)throw new RangeError("SSE event buffer limit exceeded");
  return {events,buffer:pending};
 }
 function parseBlock(block){
  let event="message";const data=[];
  for(const line of block.split(/\r\n|\n|\r/)){
   if(!line||line.startsWith(":"))continue;
   const colon=line.indexOf(":");
   const field=colon<0?line:line.slice(0,colon);
   let value=colon<0?"":line.slice(colon+1);
   if(value.startsWith(" "))value=value.slice(1);
   if(field==="event")event=value||"message";
   else if(field==="data")data.push(value);
  }
  return data.length?{event,data:data.join("\n")}:null;
 }
 return {parseSseChunk,MAX_BUFFER};
});
