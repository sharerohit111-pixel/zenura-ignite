(function(){
"use strict";
const body=document.body;
if(!body||!body.classList.contains("stocks-page"))return;
if(!(navigator.maxTouchPoints>0||("ontouchstart" in window)))return;
const HIDE="zenura-broken-bottom-image";
const WRAP="zenura-broken-bottom-image-wrap";
const STOP=new Set(["BODY","MAIN","NAV","HEADER","FOOTER","HTML"]);
function inDockZone(el){
 const r=el.getBoundingClientRect();
 const h=window.innerHeight||document.documentElement.clientHeight||0;
 return h>0&&r.width>0&&r.height>0&&r.bottom>h-210&&r.top<h;
}
function hideEmptyImageWrappers(img){
 img.classList.add(HIDE);
 let parent=img.parentElement,depth=0;
 while(parent&&parent!==body&&depth<5&&!STOP.has(parent.tagName)){
  if(!inDockZone(parent)||parent.textContent.trim().length>0)break;
  if(parent.querySelector("a,button,input,select,textarea,[role='button']"))break;
  parent.classList.add(WRAP);
  depth++;
  parent=parent.parentElement;
 }
}
function scan(){
 document.querySelectorAll("body.stocks-page img").forEach(img=>{
  if(!img.complete||img.naturalWidth!==0||!inDockZone(img))return;
  hideEmptyImageWrappers(img);
 });
}
let scheduled=false;
function schedule(){
 if(scheduled)return;
 scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;scan()});
}
function watch(img){
 if(img.dataset.zenuraDockWatch==="true")return;
 img.dataset.zenuraDockWatch="true";
 img.addEventListener("error",schedule);
 img.addEventListener("load",schedule);
}
document.querySelectorAll("body.stocks-page img").forEach(watch);
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