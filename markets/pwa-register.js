(function(){
 if(!("serviceWorker" in navigator))return;
 window.addEventListener("load",()=>{
  const script=document.currentScript;
  const base=new URL("./",script?.src||location.href);
  const worker=new URL("service-worker.js",base);
  navigator.serviceWorker.register(worker,{scope:base.pathname})
   .catch(error=>console.warn("ZENURA offline shell could not be registered:",error));
 },{once:true});
})();