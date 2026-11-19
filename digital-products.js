import {DEFAULT_DIGITAL_PRODUCTS} from "./digital-products-data.js";
import {db} from "./firebase-client.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeUrl=value=>{try{const url=new URL(String(value||""));return url.protocol==="https:"?url.href:""}catch{return ""}};
const root=document.querySelector(".products-grid");
let products=DEFAULT_DIGITAL_PRODUCTS;
let cataloguePublished=false;
function productModal(p){
 document.getElementById("digital-product-modal")?.remove();
 const el=document.createElement("div");el.id="digital-product-modal";el.className="digital-product-backdrop";
 const images=[p.imageUrl,...(Array.isArray(p.gallery)?p.gallery:[])].map(safeUrl).filter(Boolean);
 const videoUrl=safeUrl(p.videoUrl),websiteUrl=safeUrl(p.websiteUrl);
 const hero=images[0]?'<img class="digital-product-hero" src="'+esc(images[0])+'" alt="'+esc(p.name)+'" loading="lazy">':'<div class="digital-product-placeholder"><span>'+esc(p.name)+'</span><small>ZENURA IGNITE TECHNOLOGIES</small></div>';
 el.innerHTML='<article class="digital-product-dialog" role="dialog" aria-modal="true" aria-label="'+esc(p.name)+'"><button class="digital-product-close" type="button" aria-label="Close">×</button>'+hero+'<div class="digital-product-body"><small class="tag">'+esc(p.category||"PRODUCT SAMPLE")+'</small><h2>'+esc(p.name)+'</h2><h3>'+esc(p.subtitle||"")+'</h3><p>'+esc(p.description||"")+'</p><div class="digital-product-details">'+esc(p.details||"")+'</div><h4>Key Features</h4><ul class="digital-product-features">'+(p.features||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>'+(images.length>1?'<div class="digital-product-gallery">'+images.slice(1).map(src=>'<img src="'+esc(src)+'" alt="'+esc(p.name)+' feature image" loading="lazy">').join("")+'</div>':'')+'<div class="product-tags">'+(p.tags||[]).map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>'+(videoUrl?'<video class="digital-product-video" controls playsinline preload="metadata" src="'+esc(videoUrl)+'">Your browser does not support video.</video>':'')+(websiteUrl?'<a class="product-link" href="'+esc(websiteUrl)+'" target="_blank" rel="noopener noreferrer">Visit product ↗</a>':'')+'</div></article>';
 document.body.append(el);
 const close=()=>el.remove();el.querySelector(".digital-product-close").addEventListener("click",close);el.addEventListener("click",e=>{if(e.target===el)close()});
}
function bind(){root?.querySelectorAll("[data-product-detail]").forEach(b=>b.addEventListener("click",()=>{const p=products.find(x=>x.id===b.dataset.productDetail);if(p)productModal(p)}));}
function updateCard(card,p){
 const art=card.querySelector(".product-art"),content=card.querySelector(".product-content");
 if(!art||!content)return;
 art.querySelector(".product-card-image")?.remove();
 const imageUrl=safeUrl(p.imageUrl);
 if(imageUrl){const img=document.createElement("img");img.className="product-card-image";img.src=imageUrl;img.alt=p.name+" product image";img.loading="lazy";img.decoding="async";art.prepend(img);art.classList.add("has-product-image");}
 const title=content.querySelector("h3");if(title)title.textContent=p.name;
 const subtitle=content.querySelector(".product-subtitle");if(subtitle)subtitle.textContent=p.subtitle||"";
 const paragraphs=content.querySelectorAll(":scope > p:not(.product-subtitle)");if(paragraphs[0])paragraphs[0].textContent=p.description||"";
 const tags=content.querySelector(".product-tags");if(tags)tags.innerHTML=(p.tags||[]).map(x=>"<span>"+esc(x)+"</span>").join("");
 const link=content.querySelector(".product-link");if(link){link.removeAttribute("href");link.dataset.productDetail=p.id;link.textContent="View product details & images ↗";}
 card.dataset.productId=p.id;card.hidden=false;
}
async function load(){
 try{const snap=await getDoc(doc(db,"publicCatalog","digitalProducts"));if(snap.exists()){const data=snap.data();cataloguePublished=data.published===true&&Array.isArray(data.products);products=cataloguePublished?data.products.filter(p=>p&&p.visible!==false):[];}}
 catch(e){console.warn("Product samples are using built-in defaults.",e)}
 if(!root)return;
 const cards=[...root.querySelectorAll(".product-card")],used=new Set();
 const source= cataloguePublished ? products : DEFAULT_DIGITAL_PRODUCTS;
 source.forEach(p=>{
  const card=cards.find(x=>!used.has(x)&&((x.dataset.productId&&x.dataset.productId===p.id)||x.querySelector("h3")?.textContent.trim().toLowerCase()===String(p.name||"").trim().toLowerCase()));
  if(card){used.add(card);updateCard(card,p);}
 });
 if(cataloguePublished)cards.forEach(card=>{if(!used.has(card))card.hidden=true;});
 bind();
}
load();