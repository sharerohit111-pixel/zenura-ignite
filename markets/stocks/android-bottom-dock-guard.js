(function(){
"use strict";
const body=document.body;
if(!body||!body.classList.contains("stocks-page"))return;
const touch=()=>navigator.maxTouchPoints>0||("ontouchstart" in window);
if(!touch())return;
const IMAGE_CLASS="zenura-broken-bottom-image";
const WRAP_CLASS="zenura-broken-bottom-image-wrap";
function inDockZone(el){
 const r=el.getBoundingClientRect();
 const h=window.innerHeight||document.documentElement.clientHeight||0;
 return h>0&&r.width>0&&r.height>0&&r.bottom>h-190&&r.top<h;
}
function hideBrokenBottomImages(){
 document.querySelectorAll("body.stocks-page img").forEach(img=>{
  if(img.dataset.zenuraDockChecked==="true")return;
  if(!img.complete||img.naturalWidth!==0||!inDockZone(img))return;
  img.dataset.zenuraDockChecked="true";
  img.classList.add(IMAGE_CLASS);
  const parent=img.parentElement;
  if(!parent||parent===body)return;
  const siblings=[...parent.children].filter(el=>el!==img&&!el.matches("script,style"));
  if(siblings.length===0&&inDockZone(parent))parent.classList.add(WRAP_CLASS);
 });
}
let scheduled=false;
function schedule(){
 if(scheduled)return;
 scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;hideBrokenBottomImages()});
}
document.querySelectorAll("body.stocks-page img").forEach(img=>{
 img.addEventListener("error",schedule,{once:true});
 img.addEventListener("load",schedule,{once:true});
});
schedule();
const observer=new MutationObserver(records=>{
 for(const record of records){
  for(const node of record.addedNodes){
   if(node.nodeType!==1)continue;
   if(node.matches?.("img")){node.addEventListener("error",schedule,{once:true});node.addEventListener("load",schedule,{once:true});}
   node.querySelectorAll?.("img").forEach(img=>{img.addEventListener("error",schedule,{once:true});img.addEventListener("load",schedule,{once:true})});
  }
 }
 schedule();
});
observer.observe(body,{childList:true,subtree:true});
window.addEventListener("resize",schedule,{passive:true});
window.addEventListener("scroll",schedule,{passive:true});
})();