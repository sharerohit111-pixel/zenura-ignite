(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root){
    root.ZenuraChartTheme=api;
    if(root.document)api.mount(root.document,()=>root.localStorage);
  }
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const STORAGE_KEY="zenura-paper-chart-theme-v1";
  function normalizeTheme(value){return value==="light"?"light":"dark";}
  function nextTheme(value){return normalizeTheme(value)==="dark"?"light":"dark";}
  function actionLabel(theme,language){
    const hindi=language==="hi";
    if(theme==="light")return hindi?"गहरा चार्ट":"DARK CHART";
    return hindi?"हल्का चार्ट":"LIGHT CHART";
  }
  function mount(documentRef,getStorage){
    const button=documentRef?.getElementById?.("paper-chart-theme-toggle");
    const body=documentRef?.body;
    if(!button||!body)return null;
    let storage=null;
    try{storage=typeof getStorage==="function"?getStorage():null;}catch(_){}
    let theme="dark";
    try{theme=normalizeTheme(storage?.getItem(STORAGE_KEY));}catch(_){}
    const languageButton=documentRef.getElementById("paper-language-toggle");
    function language(){return languageButton?.textContent?.trim()==="English"?"hi":"en";}
    function render(){
      body.dataset.chartTheme=theme;
      button.textContent=actionLabel(theme,language());
      button.setAttribute("aria-pressed",String(theme==="light"));
      button.setAttribute("aria-label",theme==="light"?"Switch charts to dark theme":"Switch charts to light theme");
    }
    function persist(){
      try{storage?.setItem(STORAGE_KEY,theme);}catch(_){}
    }
    button.addEventListener("click",()=>{
      theme=nextTheme(theme);
      render();
      persist();
    });
    languageButton?.addEventListener("click",render);
    render();
    return {getTheme:()=>theme,setTheme(value){theme=normalizeTheme(value);render();persist();}};
  }
  return {normalizeTheme,nextTheme,actionLabel,mount,STORAGE_KEY};
});
