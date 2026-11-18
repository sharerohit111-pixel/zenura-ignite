"use strict";

function formatSseEvent(event,payload){
  if(typeof event!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(event))throw new TypeError("Invalid SSE event name");
  return "event: "+event+"\ndata: "+JSON.stringify(payload)+"\n\n";
}
function formatSseComment(comment=""){
  if(typeof comment!=="string"||/[\r\n]/.test(comment))throw new TypeError("Invalid SSE comment");
  return ": "+comment+"\n\n";
}
module.exports={formatSseEvent,formatSseComment};
