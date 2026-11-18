"use strict";
const DEFAULT_MAX_FRAME_BYTES=1024*1024;
function writeSseFrame(res,upstream,frame,maxFrameBytes=DEFAULT_MAX_FRAME_BYTES){
 if(!res||res.destroyed||res.writableEnded)return false;
 if(typeof frame!=="string")throw new TypeError("SSE frame must be a string");
 const bytes=Buffer.byteLength(frame);
 if(!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<1||bytes>maxFrameBytes)
  throw Object.assign(new Error("Market feed frame exceeds the configured size limit."),{status:413});
 const accepted=res.write(frame);
 if(!accepted&&upstream&&upstream.readyState===1&&typeof upstream.pause==="function")upstream.pause();
 return accepted;
}
function resumeUpstream(upstream,closed=false){
 if(closed||!upstream||upstream.readyState!==1||typeof upstream.resume!=="function")return false;
 upstream.resume();
 return true;
}
module.exports={DEFAULT_MAX_FRAME_BYTES,writeSseFrame,resumeUpstream};
