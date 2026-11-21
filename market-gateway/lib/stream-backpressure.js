"use strict";
const DEFAULT_MAX_FRAME_BYTES=1024*1024;

// The ws package exposes its underlying Node socket as _socket; unlike a
// net.Socket, a WebSocket instance itself does not implement pause()/resume().
function getTransportSocket(upstream){
 if(!upstream||upstream.readyState!==1)return null;
 if(typeof upstream.pause==="function"&&typeof upstream.resume==="function")return upstream;
 const socket=upstream._socket;
 return socket&&!socket.destroyed&&
  typeof socket.pause==="function"&&typeof socket.resume==="function"?socket:null;
}
function writeSseFrame(res,upstream,frame,maxFrameBytes=DEFAULT_MAX_FRAME_BYTES){
 if(!res||res.destroyed||res.writableEnded)return false;
 if(typeof frame!=="string")throw new TypeError("SSE frame must be a string");
 const bytes=Buffer.byteLength(frame);
 if(!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<1||bytes>maxFrameBytes)
  throw Object.assign(new Error("Market feed frame exceeds the configured size limit."),{status:413});
 const accepted=res.write(frame);
 if(!accepted)getTransportSocket(upstream)?.pause();
 return accepted;
}
function resumeUpstream(upstream,closed=false){
 if(closed)return false;
 const socket=getTransportSocket(upstream);
 if(!socket)return false;
 socket.resume();
 return true;
}
module.exports={DEFAULT_MAX_FRAME_BYTES,writeSseFrame,resumeUpstream};
