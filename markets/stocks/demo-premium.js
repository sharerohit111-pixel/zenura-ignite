(function(){
"use strict";
const body=document.body,KEY="zenura-s-trade-app-theme-v1";
const svg={sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>',moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"/></svg>',home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18M6 14l4-4 3 2 5-7"/></svg>',list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h16"/></svg>',wallet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h9M3 11h18"/></svg>'};
let theme="day";try{theme=localStorage.getItem(KEY)==="night"?"night":"day"}catch(_){}
const meta=document.querySelector('meta[name="theme-color"]');
const header=document.querySelector(".demo-header");
const toggle=document.createElement("button");toggle.type="button";toggle.className="demo-theme-switch";toggle.addEventListener("click",()=>{theme=theme==="day"?"night":"day";render()});header?.append(toggle);
function render(){body.dataset.appTheme=theme;if(meta)meta.content=theme==="day"?"#f5f7f8":"#080b10";toggle.innerHTML=(theme==="day"?svg.moon:svg.sun)+"<span>"+(theme==="day"?"Night mode":"Day mode")+"</span>";toggle.setAttribute("aria-pressed",String(theme==="night"));try{localStorage.setItem(KEY,theme)}catch(_){}}
const targets=[["home","Home",svg.home],["market","Market",svg.chart],["watchlists","Watchlist",svg.list],["charts","Charts",svg.chart],["portfolio","Portfolio",svg.wallet]];
const nav=document.createElement("nav");nav.className="demo-bottom-nav";nav.setAttribute("aria-label","Demo quick navigation");
targets.forEach(([id,label,icon])=>{const b=document.createElement("button");b.type="button";b.innerHTML=icon+"<span>"+label+"</span>";b.addEventListener("click",()=>document.querySelector('[data-screen="'+id+'"]')?.click());nav.append(b)});
document.body.append(nav);
function sync(){const current=document.querySelector("#screen-nav button.active")?.dataset.screen||"home";nav.querySelectorAll("button").forEach((b,i)=>b.classList.toggle("active",targets[i][0]===current))}
document.querySelector("#screen-nav")?.addEventListener("click",()=>setTimeout(sync,0));
render();sync();window.addEventListener("storage",e=>{if(e.key===KEY){theme=e.newValue==="night"?"night":"day";render()}});
})();