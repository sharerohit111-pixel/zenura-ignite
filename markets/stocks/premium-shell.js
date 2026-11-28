(function(){
"use strict";
const body=document.body;
const KEY="zenura-s-trade-app-theme-v1";
const icons={
dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>',
chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="m6 14 4-4 3 2 5-7"/></svg>',
watchlist:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h16"/><path d="m8 5 2 2 4-4"/></svg>',
portfolio:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 11h18M10 11v3h4v-3"/></svg>',
profile:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
options:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h18M3 17h18"/><path d="M7 3v8m10 2v8"/><circle cx="7" cy="13" r="2"/><circle cx="17" cy="11" r="2"/></svg>',
pnl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5m0 14h16"/><path d="m7 15 4-4 3 2 5-7"/><path d="M16 6h3v3"/></svg>',
sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>',
moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"/></svg>'
};
const pageIcons={dashboard:"dashboard",chart:"chart",watchlist:"watchlist",balance:"portfolio",positions:"portfolio",orders:"chart",history:"chart",pnl:"pnl",derivatives:"options",settings:"profile"};
let theme="day";
try{theme=localStorage.getItem(KEY)==="night"?"night":"day"}catch(_){}
function syncChartTheme(){
 const want=theme==="day"?"light":"dark";
 if(body.dataset.chartTheme!==want){
  const legacy=document.getElementById("paper-chart-theme-toggle");
  if(legacy)legacy.click();
  body.dataset.chartTheme=want;
 }
}
function render(){
 body.dataset.appTheme=theme;
 const themeMeta=document.querySelector('meta[name="theme-color"]');if(themeMeta)themeMeta.content=theme==="day"?"#f5f7f8":"#080b10";
 const btn=document.querySelector("[data-app-theme-toggle]");
 if(btn){btn.innerHTML=(theme==="day"?icons.moon:icons.sun)+'<span>'+(theme==="day"?"Night mode":"Day mode")+'</span>';btn.setAttribute("aria-label",theme==="day"?"Switch to night mode":"Switch to day mode");btn.setAttribute("aria-pressed",String(theme==="night"));}
 syncChartTheme();
 try{localStorage.setItem(KEY,theme)}catch(_){}
}
const header=document.querySelector(".top");
if(header&&!header.querySelector("[data-app-theme-toggle]")){
 const btn=document.createElement("button");btn.type="button";btn.className="app-theme-switch";btn.dataset.appThemeToggle="";btn.addEventListener("click",()=>{theme=theme==="day"?"night":"day";render()});header.append(btn);
}
// Keep existing navigation anchor contents intact. Replacing innerHTML here can
// detach the terminal document when malformed/legacy markup nests page content
// inside the first anchor. The desktop navigation remains text-first and safe.
document.querySelectorAll(".terminal-nav > a[data-terminal-page]").forEach(a=>{
 a.classList.add("terminal-nav-link");
});
const bottom=document.createElement("nav");bottom.className="app-bottom-nav";bottom.dataset.appBottomNav="";bottom.setAttribute("aria-label","Quick trading navigation");bottom.setAttribute("role","navigation");bottom.dataset.quickTradeNav="";
const items=[["derivatives","Option Chain"],["support","Help & Support"],["positions","Live Pos. / P&L"],["watchlist","Quick Watchlist"]];
items.forEach(([page,label])=>{
 const a=document.createElement("a");
 a.href="#"+page;
 a.dataset.bottomPage=page;
 a.setAttribute("aria-label",label);
 a.innerHTML=icons[pageIcons[page]||"profile"]+"<span>"+label+"</span>";
 a.addEventListener("click",e=>{
  e.preventDefault();
  const target=document.querySelector('[data-terminal-page="'+page+'"]');
  if(target)target.click();
  else{location.hash=page;}
 });
 bottom.append(a);
});
document.body.append(bottom);
function active(){const p=body.dataset.terminalPage||location.hash.slice(1)||"dashboard";bottom.querySelectorAll("a").forEach(a=>{if(a.dataset.bottomPage===p)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")})}
document.addEventListener("click",e=>{if(e.target.closest("[data-terminal-page],[data-go-page]"))setTimeout(active,0)});
window.addEventListener("hashchange",active);
render();active();
window.addEventListener("storage",e=>{if(e.key===KEY){theme=e.newValue==="night"?"night":"day";render()}});
})();