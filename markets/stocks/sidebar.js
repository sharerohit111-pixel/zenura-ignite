(function(){
"use strict";
const body=document.body,header=document.querySelector(".top");
if(!header||document.getElementById("zenura-sidebar"))return;
const icons={
dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="m6 14 4-4 3 2 5-7"/></svg>',
watchlist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h16"/></svg>',
options:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h18M3 17h18M7 3v8m10 2v8"/><circle cx="7" cy="13" r="2"/><circle cx="17" cy="11" r="2"/></svg>',
portfolio:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 11h18"/></svg>',
orders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h10l4 4v14H3V3zM7 3v5h10V3M7 13h10M7 17h7"/></svg>',
wallet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h9M3 11h18m-5 3h2"/></svg>',
pnl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5m0 14h16m-13-4 4-4 3 2 5-7"/><path d="M16 6h3v3"/></svg>',
settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7Z"/></svg>',
help:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-1.1 1.1-2.1 1.4-2.1 3M12 17.5h.01"/></svg>'
};
const pages=[
["dashboard","Dashboard","dashboard"],["chart","Chart & Trade","chart"],["watchlist","Watchlist","watchlist"],
["derivatives","Option Chain","options"],["positions","Portfolio & Positions","portfolio"],
["orders","Orders & Trade History","orders"],["balance","Virtual Wallet","wallet"],
["pnl","P&L","pnl"],["settings","Settings","settings"],["support","Help & Support","help"]
];
const trigger=document.createElement("button");trigger.type="button";trigger.id="zenura-sidebar-toggle";trigger.className="sidebar-toggle";trigger.setAttribute("aria-label","Open navigation menu");trigger.setAttribute("aria-expanded","false");trigger.innerHTML='<span></span><span></span><span></span>';
header.append(trigger);
const overlay=document.createElement("div");overlay.className="sidebar-overlay";overlay.hidden=true;
const drawer=document.createElement("aside");drawer.id="zenura-sidebar";drawer.className="zenura-sidebar";drawer.setAttribute("aria-label","Main navigation");drawer.setAttribute("aria-hidden","true");
drawer.innerHTML='<div class="sidebar-head"><div class="sidebar-brand"><b>ZENURA <i>IGNITE</i></b><small>S-TRADE · PAPER TRADING</small></div><button type="button" class="sidebar-close" aria-label="Close navigation">×</button></div><div class="sidebar-caption">WORKSPACE</div><nav class="sidebar-links" aria-label="Main pages"></nav><div class="sidebar-foot"><span>Paper Trading Only</span><small>Powered by ZENURA IGNITE Technologies</small></div>';
const nav=drawer.querySelector(".sidebar-links");
pages.forEach(([id,label,ico])=>{const a=document.createElement("a");a.href="#"+id;a.dataset.sidebarPage=id;a.innerHTML=icons[ico]+'<span>'+label+'</span>';a.addEventListener("click",e=>{e.preventDefault();navigate(id);close()});nav.append(a)});
document.body.append(overlay,drawer);
const settings=document.querySelector(".settings-page");
if(settings&&!settings.querySelector(".settings-feature-grid")){
 const grid=document.createElement("div");grid.className="settings-feature-grid";
 const features=[
 ["theme","Day / Night Theme","App की रोशनी और रंग बदलें"],
 ["language","हिंदी / English भाषा","ऐप की भाषा बदलें"],
 ["chart","Chart Settings","चार्ट प्रकार और indicators"],
 ["notifications","Notifications & Alerts","ब्राउज़र नोटिफिकेशन अनुमति"],
 ["account","Account & Upstox Connection","अकाउंट और Upstox कनेक्शन"],
 ["security","Security & Logout","सुरक्षा और सुरक्षित साइन आउट"]
 ];
 features.forEach(([id,title,desc])=>{const b=document.createElement("button");b.type="button";b.className="settings-feature";b.dataset.settingsFeature=id;b.innerHTML='<b>'+title+'</b><span>'+desc+'</span><span class="settings-feature-arrow">›</span>';b.addEventListener("click",()=>runSetting(id));grid.append(b)});
 settings.append(grid);
 const status=document.createElement("p");status.className="settings-action-status";status.id="settings-action-status";status.setAttribute("role","status");status.textContent="Settings changes apply to this device or your existing signed-in session.";settings.append(status);
}
function navigate(id){
 const link=document.querySelector('[data-terminal-page="'+id+'"]');
 if(link)link.click();else{location.hash="#"+id;window.dispatchEvent(new HashChangeEvent("hashchange"));}
 syncActive(id);
}
function syncActive(id){drawer.querySelectorAll("[data-sidebar-page]").forEach(a=>{if(a.dataset.sidebarPage===id)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")})}
function open(){overlay.hidden=false;requestAnimationFrame(()=>{drawer.classList.add("is-open");overlay.classList.add("is-visible")});drawer.setAttribute("aria-hidden","false");trigger.setAttribute("aria-expanded","true");trigger.setAttribute("aria-label","Close navigation");body.classList.add("sidebar-open");drawer.querySelector(".sidebar-close").focus()}
function close(){drawer.classList.remove("is-open");overlay.classList.remove("is-visible");drawer.setAttribute("aria-hidden","true");trigger.setAttribute("aria-expanded","false");trigger.setAttribute("aria-label","Open navigation");body.classList.remove("sidebar-open");setTimeout(()=>{overlay.hidden=true},220);trigger.focus()}
trigger.addEventListener("click",()=>drawer.classList.contains("is-open")?close():open());
drawer.querySelector(".sidebar-close").addEventListener("click",close);overlay.addEventListener("click",close);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&drawer.classList.contains("is-open"))close()});
window.addEventListener("hashchange",()=>{const id=location.hash.slice(1)||"dashboard";syncActive(id);if(drawer.classList.contains("is-open"))close()});
function status(message){const el=document.getElementById("settings-action-status");if(el)el.textContent=message}
function runSetting(id){
 if(id==="theme"){document.querySelector("[data-app-theme-toggle]")?.click();status("Day / Night theme बदल दिया गया।");return}
 if(id==="language"){document.querySelector("#paper-language-toggle")?.click();status("Language control सक्रिय किया गया।");return}
 if(id==="chart"){navigate("chart");close();setTimeout(()=>document.querySelector("#chart-type-select")?.focus(),80);return}
 if(id==="account"){navigate("dashboard");close();setTimeout(()=>document.querySelector("#upstox-connect")?.click(),80);return}
 if(id==="security"){
  const out=document.querySelector("#email-sign-out");
  if(out&&!out.hidden){out.click();status("Supabase sign-out request भेजी गई।");}
  else if(window.ZENURA_SUPABASE?.auth?.signOut){window.ZENURA_SUPABASE.auth.signOut().then(({error})=>status(error?"Sign out failed: "+error.message:"आप सुरक्षित रूप से sign out हो गए।")).catch(e=>status("Sign out failed: "+e.message));}
  else status("पहले अकाउंट में sign in करें; Security action मौजूदा Supabase Auth से जुड़ा है।");
  return;
 }
 if(id==="notifications"){
  if(!("Notification" in window)){status("इस ब्राउज़र में Notifications उपलब्ध नहीं हैं।");return}
  if(Notification.permission==="granted"){status("Browser notifications की अनुमति पहले से चालू है।");return}
  if(Notification.permission==="denied"){status("Notifications ब्राउज़र सेटिंग्स में Block हैं। साइट की अनुमति बदलें।");return}
  Notification.requestPermission().then(p=>status(p==="granted"?"Browser notifications की अनुमति मिल गई।":p==="denied"?"Notifications की अनुमति अस्वीकार हुई।":"अनुमति अभी नहीं दी गई।")).catch(()=>status("Notification permission उपलब्ध नहीं हो सकी।"));
 }
}
syncActive(location.hash.slice(1)||"dashboard");
window.addEventListener("storage",e=>{if(e.key==="zenura-s-trade-app-theme-v1")body.dataset.appTheme=e.newValue==="night"?"night":"day"});
})();
