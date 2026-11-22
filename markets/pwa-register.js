(function(){
 if(!("serviceWorker" in navigator))return;
 const scriptUrl=document.currentScript?.src;
 window.addEventListener("load",()=>{
  const base=new URL("./",scriptUrl||location.href);
  const worker=new URL("service-worker.js",base);
  navigator.serviceWorker.register(worker,{scope:base.pathname})
   .catch(error=>console.warn("ZENURA offline shell could not be registered:",error));
 },{once:true});
})();