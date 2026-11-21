"use strict";
function createStreamLifecycle(cleanup){
 if(typeof cleanup!=="function")throw new TypeError("Stream cleanup must be a function");
 let closed=false;
 return {
  get closed(){return closed;},
  stop(){
   if(closed)return false;
   closed=true;
   cleanup();
   return true;
  }
 };
}
module.exports={createStreamLifecycle};
