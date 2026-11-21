"use strict";
function decodeFeedResponse(FeedResponse,bytes){
 if(!FeedResponse||typeof FeedResponse.decode!=="function"||typeof FeedResponse.toObject!=="function")
  throw new TypeError("A valid Upstox FeedResponse protobuf type is required");
 if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))
  throw new TypeError("Upstox feed payload must be binary");
 const message=FeedResponse.decode(bytes);
 return FeedResponse.toObject(message,{longs:String,enums:String,defaults:false,oneofs:true});
}
module.exports={decodeFeedResponse};
