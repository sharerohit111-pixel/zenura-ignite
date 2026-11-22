(function(){
 if(!("serviceWorker" in navigator))return;
 window.addEventListener("load",()=>{
  navigator.serviceWorker.register("/markets/service-worker.js",{scope:"/markets/"})
   .catch(error=>console.warn("ZENURA offline shell could not be registered:",error));
 },{once:true});
})();