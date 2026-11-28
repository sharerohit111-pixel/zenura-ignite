(function(){
"use strict";
if(!("serviceWorker" in navigator))return;
const scriptUrl=document.currentScript?.src;
let hadController=Boolean(navigator.serviceWorker.controller);
navigator.serviceWorker.addEventListener("controllerchange",()=>{
 if(hadController){
  // A waiting worker has taken control: reload once so the new shell is used.
  location.reload();
  return;
 }
 hadController=true;
});
window.addEventListener("load",async()=>{
 const base=new URL("./",scriptUrl||location.href);
 const worker=new URL("service-worker.js",base);
 try{
  const registration=await navigator.serviceWorker.register(worker,{
   scope:base.pathname,
   updateViaCache:"none"
  });
  // Ask the browser to check the canonical worker URL for a new release.
  await registration.update().catch(()=>{});
  document.addEventListener("visibilitychange",()=>{
   if(document.visibilityState==="visible")registration.update().catch(()=>{});
  });
 }catch(error){
  console.warn("ZENURA offline shell could not be registered:",error);
 }
},{once:true});
})();