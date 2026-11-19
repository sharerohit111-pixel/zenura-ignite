import { DEFAULT_SOLUTIONS } from "./solutions-catalogue-data.js";
import { db } from "./firebase-client.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const root=document.getElementById("solution-catalogue");
const clone=x=>JSON.parse(JSON.stringify(x));
const esc=v=>{let value=String(v??"");if(window.ZenuraI18n?.getLanguage?.()==="en")value=window.ZenuraI18n.toEnglish?.(value)??value;return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));};
const money=n=>"₹"+Number(n||0).toLocaleString("en-IN");
let categories=clone(DEFAULT_SOLUTIONS),active="all";
function render(){
 const visible=categories.filter(c=>c.products?.some(p=>p.visible!==false));
 root.innerHTML='<div class="catalogue-toolbar"><div class="catalogue-filters"><button class="catalogue-filter '+(active==="all"?"active":"")+'" data-cat="all">All sectors</button>'+visible.map(c=>'<button class="catalogue-filter '+(active===c.id?"active":"")+'" data-cat="'+esc(c.id)+'">'+esc(c.name)+'</button>').join("")+'</div></div>'+
 (visible.filter(c=>active==="all"||active===c.id).map(c=>'<section class="catalogue-category"><div class="catalogue-category-head"><span class="catalogue-category-icon">'+esc(c.icon||"✦")+'</span><div><h3>'+esc(c.name)+'</h3><p>'+esc(c.description)+'</p></div></div><div class="catalogue-products">'+c.products.filter(p=>p.visible!==false).map(p=>card(p,c)).join("")+'</div></section>').join("")||'<div class="solution-empty">इस श्रेणी में अभी कोई प्रकाशित समाधान उपलब्ध नहीं है।</div>');
 root.querySelectorAll("[data-cat]").forEach(b=>b.addEventListener("click",()=>{active=b.dataset.cat;render()}));
 root.querySelectorAll("[data-detail]").forEach(b=>b.addEventListener("click",()=>detail(find(b.dataset.detail))));
}
function card(p,c){return '<article class="solution-product"><div class="solution-product-top"><span class="solution-product-icon">'+esc(p.icon||"✦")+'</span><h4>'+esc(p.name)+'</h4><p>'+esc(p.desc)+'</p></div><div class="solution-plans">'+mini("SILVER",p.silver,false)+mini("GOLDEN",p.gold,true)+'</div><div class="solution-product-actions"><button class="solution-detail-btn" data-detail="'+esc(p.id)+'">View features & plan details ↗</button></div></article>'}
function mini(label,plan,gold){plan=plan||{price:0,features:[]};return '<div class="solution-plan '+(gold?"gold":"")+'"><div class="solution-plan-label">'+label+' PLAN</div><div class="solution-plan-price">'+money(plan.price)+'</div><div class="solution-plan-caption">Indicative project price</div><ul>'+(plan.features||[]).slice(0,3).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>'}
function find(id){for(const c of categories){const p=c.products.find(x=>x.id===id);if(p)return {p,c}}return null}
function modal(html){document.getElementById("solution-modal-backdrop")?.remove();const el=document.createElement("div");el.id="solution-modal-backdrop";el.className="solution-modal-backdrop open";el.innerHTML='<div class="solution-modal" role="dialog" aria-modal="true">'+html+'</div>';document.body.append(el);el.addEventListener("click",e=>{if(e.target===el)el.remove()});el.querySelector("[data-close]")?.addEventListener("click",()=>el.remove())}
function detail(found){if(!found)return;const {p,c}=found;modal('<div class="solution-modal-head"><div><small style="color:#58e5ff">'+esc(c.name)+'</small><h3>'+esc(p.name)+'</h3></div><button class="solution-modal-close" data-close>Close ✕</button></div><p style="color:#b9c9df;font-size:13px;line-height:1.7">'+esc(p.desc)+'</p><div class="solution-detail-plans"><div><h4>Silver Plan · '+money(p.silver.price)+'</h4><ul class="solution-detail-features">'+p.silver.features.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div><div class="gold"><h4>Golden Plan · '+money(p.gold.price)+'</h4><ul class="solution-detail-features">'+p.gold.features.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div></div><p style="font-size:10px;color:#93a5c2;margin-top:16px">Indicative pricing only. Final quotation depends on scope, content, hosting and custom requirements.</p><div class="solution-modal-actions"><button id="request-solution">Request this solution ↗</button></div>');
 document.getElementById("request-solution").addEventListener("click",()=>{document.getElementById("contact")?.scrollIntoView({behavior:"smooth"});document.getElementById("solution-modal-backdrop")?.remove()});
}
async function load(){try{const snap=await getDoc(doc(db,"publicCatalog","businessSolutions"));if(snap.exists()&&snap.data().published&&Array.isArray(snap.data().categories))categories=snap.data().categories;}catch(e){console.warn("Business catalogue is showing its built-in public fallback.",e)}render()}
load();
