(function(){
 if(!("serviceWorker" in navigator))return;
 const scriptUrl=document.currentScript?.src;
 const base=new URL("./",scriptUrl||location.href);
 const worker=new URL("service-worker.js",base);
 // Register immediately: do not depend on a window load listener that may
 // already have fired in cached/PWA navigation or test harnesses.
 navigator.serviceWorker.register(worker,{scope:base.pathname})
  .catch(error=>console.error("ZENURA offline shell could not be registered:",error));
})();