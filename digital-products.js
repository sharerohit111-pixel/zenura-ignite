import {DEFAULT_DIGITAL_PRODUCTS} from "./digital-products-data.js";
import {db} from "./firebase-client.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const root=document.querySelector(".products-grid");
let products=DEFAULT_DIGITAL_PRODUCTS;
function productModal(p){
 document.getElementById("digital-product-modal")?.remove();
 const el=document.createElement("div");el.id="digital-product-modal";el.className="digital-product-backdrop";
 const images=[p.imageUrl,...(p.gallery||[])].filter(Boolean);
 const hero=images[0]?'<img class="digital-product-hero" src="'+esc(images[0])+'" alt="'+esc(p.name)+'" loading="lazy">':'<div class="digital-product-placeholder"><span>'+esc(p.name)+'</span><small>ZENURA IGNITE TECHNOLOGIES</small></div>';
 el.innerHTML='<article class="digital-product-dialog" role="dialog" aria-modal="true" aria-label="'+esc(p.name)+'"><button class="digital-product-close" type="button" aria-label="Close">×</button>'+hero+'<div class="digital-product-body"><small class="tag">'+esc(p.category||"ZENURA DIGITAL PRODUCT")+'</small><h2>'+esc(p.name)+'</h2><h3>'+esc(p.subtitle||"")+'</h3><p>'+esc(p.description||"")+'</p><div class="digital-product-details">'+esc(p.details||"")+'</div><h4>Key Features</h4><ul class="digital-product-features">'+(p.features||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>'+(images.length>1?'<div class="digital-product-gallery">'+images.slice(1).map(src=>'<img src="'+esc(src)+'" alt="'+esc(p.name)+' feature image" loading="lazy">').join("")+'</div>':'')+'<div class="product-tags">'+(p.tags||[]).map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>'+(p.videoUrl?'<video class="digital-product-video" controls playsinline preload="metadata" src="'+esc(p.videoUrl)+'">Your browser does not support video.</video>':'')+(p.websiteUrl?'<a class="product-link" href="'+esc(p.websiteUrl)+'" target="_blank" rel="noopener">Visit product ↗</a>':'')+'</div></article>';
 document.body.append(el);el.querySelector(".digital-product-close").addEventListener("click",()=>el.remove());el.addEventListener("click",e=>{if(e.target===el)el.remove()});
}
function bind(){
 root?.querySelectorAll("[data-product-detail]").forEach(b=>b.addEventListener("click",()=>{const p=products.find(x=>x.id===b.dataset.productDetail);if(p)productModal(p)}));
}
async function load(){
 try{const snap=await getDoc(doc(db,"publicCatalog","digitalProducts"));if(snap.exists()&&snap.data().published&&Array.isArray(snap.data().products))products=snap.data().products;}
 catch(e){console.warn("Digital product details are using built-in defaults.",e)}
 if(root){products.forEach(p=>{const card=[...root.querySelectorAll(".product-card")].find(x=>x.querySelector("h3")?.textContent.trim().toLowerCase()===p.name.toLowerCase());if(card){const link=card.querySelector(".product-link");if(link){link.removeAttribute("href");link.dataset.productDetail=p.id;link.textContent="Explore product details ↗";}if(p.imageUrl){const art=card.querySelector(".product-art");if(art){const img=document.createElement("img");img.className="product-card-image";img.src=p.imageUrl;img.alt=p.name+" product image";img.loading="lazy";art.prepend(img)}}}});bind();}
}
load();
