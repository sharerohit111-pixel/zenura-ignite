(function(){
"use strict";
const body=document.body;
if(!body)return;
const HIDE="zenura-failed-bottom-asset";
const WRAP="zenura-empty-bottom-asset-wrap";
const STOP=new Set(["BODY","MAIN","NAV","HEADER","FOOTER","HTML"]);
function inBottomViewport(el){
 const r=el.getBoundingClientRect();
 const h=window.innerHeight||document.documentElement.clientHeight||0;
 return h>0&&r.width>0&&r.height>0&&r.bottom>h-220&&r.top<h;
}
function clean(img){
 img.classList.add(HIDE);
 let parent=img.parentElement,depth=0;
 while(parent&&parent!==body&&depth<5&&!STOP.has(parent.tagName)){
  if(!inBottomViewport(parent)||parent.textContent.trim().length>0)break;
  if(parent.querySelector("button,input,select,textarea,[role='button']"))break;
  parent.classList.add(WRAP);
  depth++;
  parent=parent.parentElement;
 }
}
function scan(){
 document.querySelectorAll("body img").forEach(img=>{
  if(img.complete&&img.naturalWidth===0&&inBottomViewport(img))clean(img);
 });
}
let pending=false;
function schedule(){
 if(pending)return;
 pending=true;
 requestAnimationFrame(()=>{pending=false;scan()});
}
function watch(img){
 if(img.dataset.zenuraBottomAssetWatch==="1")return;
 img.dataset.zenuraBottomAssetWatch="1";
 img.addEventListener("error",schedule);
 img.addEventListener("load",schedule);
}
document.querySelectorAll("body img").forEach(watch);
schedule();
const observer=new MutationObserver(records=>{
 for(const record of records)for(const node of record.addedNodes){
  if(node.nodeType!==1)continue;
  if(node.matches?.("img"))watch(node);
  node.querySelectorAll?.("img").forEach(watch);
 }
 schedule();
});
observer.observe(body,{childList:true,subtree:true});
window.addEventListener("resize",schedule,{passive:true});
window.addEventListener("scroll",schedule,{passive:true});
document.addEventListener("visibilitychange",schedule);
})();