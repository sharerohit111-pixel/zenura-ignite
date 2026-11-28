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
function hasOtherContent(parent,img){
 for(const node of parent.childNodes){
  if(node===img)continue;
  if(node.nodeType===3&&node.textContent.trim())return true;
  if(node.nodeType!==1)continue;
  if(node.matches("script,style,template")||node.hidden||node.getAttribute("aria-hidden")==="true")continue;
  if(node.matches("img")&&node.classList.contains(HIDE))continue;
  return true;
 }
 return false;
}
function clean(img){
 if(!inBottomViewport(img))return;
 img.classList.add(HIDE);
 img.setAttribute("aria-hidden","true");
 let parent=img.parentElement,depth=0;
 while(parent&&parent!==body&&depth<6&&!STOP.has(parent.tagName)){
  if(!inBottomViewport(parent)||hasOtherContent(parent,img))break;
  if(parent.querySelector("button,input,select,textarea,[role='button'],a[href]"))break;
  parent.classList.add(WRAP);
  depth++;
  const child=parent;
  parent=parent.parentElement;
  img=child;
 }
}
function isBroken(img){
 return img.dataset.zenuraImageFailed==="1"||(img.complete&&img.naturalWidth===0);
}
function scan(){
 document.querySelectorAll("body img").forEach(img=>{
  if(isBroken(img))clean(img);
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
 img.addEventListener("error",()=>{img.dataset.zenuraImageFailed="1";schedule()});
 img.addEventListener("load",()=>{delete img.dataset.zenuraImageFailed;schedule()});
}
document.querySelectorAll("body img").forEach(watch);
document.addEventListener("error",event=>{
 const target=event.target;
 if(target instanceof HTMLImageElement){target.dataset.zenuraImageFailed="1";schedule()}
},true);
schedule();
const observer=new MutationObserver(records=>{
 for(const record of records){
  if(record.type==="attributes"){
   if(record.target instanceof HTMLImageElement){
    delete record.target.dataset.zenuraImageFailed;
    watch(record.target);
   }
   continue;
  }
  for(const node of record.addedNodes){
   if(node.nodeType!==1)continue;
   if(node.matches?.("img"))watch(node);
   node.querySelectorAll?.("img").forEach(watch);
  }
 }
 schedule();
});
observer.observe(body,{childList:true,subtree:true,attributes:true,attributeFilter:["src","srcset"]});
window.addEventListener("load",schedule,{once:true});
window.addEventListener("resize",schedule,{passive:true});
window.addEventListener("scroll",schedule,{passive:true});
document.addEventListener("visibilitychange",schedule);
})();