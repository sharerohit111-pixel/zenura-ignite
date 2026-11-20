import {DEFAULT_DIGITAL_PRODUCTS} from "./digital-products-data.js";
import {db} from "./firebase-client.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const assetUrl=src=>{const value=String(src??"").trim();if(!value)return "";try{return new URL(value,import.meta.url).href}catch{return ""}};
const root=document.querySelector(".products-grid");
let products=DEFAULT_DIGITAL_PRODUCTS;
function productModal(p){
 document.getElementById("digital-product-modal")?.remove();
 const el=document.createElement("div");el.id="digital-product-modal";el.className="digital-product-backdrop";
 const images=[p.imageUrl,...(p.gallery||[])].map(assetUrl).filter(Boolean);
 const hero=images[0]?'<img class="digital-product-hero" src="'+esc(images[0])+'" alt="'+esc(p.name)+'" loading="eager">':'<div class="digital-product-placeholder"><span>'+esc(p.name)+'</span><small>ZENURA IGNITE TECHNOLOGIES</small></div>';
 el.innerHTML='<article class="digital-product-dialog" role="dialog" aria-modal="true" aria-label="'+esc(p.name)+'"><button class="digital-product-close" type="button" aria-label="Close">×</button>'+hero+'<div class="digital-product-body"><small class="tag">'+esc(p.category||"PRODUCT SAMPLE")+'</small><h2>'+esc(p.name)+'</h2><h3>'+esc(p.subtitle||"")+'</h3><p>'+esc(p.description||"")+'</p><div class="digital-product-details">'+esc(p.details||"")+'</div><h4>Key Features</h4><ul class="digital-product-features">'+(p.features||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>'+(images.length>1?'<div class="digital-product-gallery">'+images.slice(1).map(src=>'<img src="'+esc(src)+'" alt="'+esc(p.name)+' feature image" loading="eager" decoding="async">').join("")+'</div>':'')+'<div class="product-tags">'+(p.tags||[]).map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>'+(p.videoUrl?'<video class="digital-product-video" controls playsinline preload="metadata" src="'+esc(p.videoUrl)+'">Your browser does not support video.</video>':'')+(p.websiteUrl?'<a class="product-link" href="'+esc(p.websiteUrl)+'" target="_blank" rel="noopener">Open Live Demo ↗</a>':'')+'</div></article>';
 document.body.append(el);
 const close=()=>el.remove();el.querySelector(".digital-product-close").addEventListener("click",close);el.addEventListener("click",e=>{if(e.target===el)close()});
}
function openProductFromCard(card){
 const id=card?.dataset.productId;
 const p=products.find(x=>String(x.id)===String(id));
 if(p)productModal(p);
}
function bind(){
 if(!root||root.dataset.productSamplesBound==="true")return;
 root.dataset.productSamplesBound="true";
 root.addEventListener("click",event=>{
  const demo=event.target.closest("[data-live-demo]");
  if(demo)return;
  const link=event.target.closest("[data-product-detail]");
  const card=event.target.closest(".product-card");
  if(link){event.preventDefault();event.stopPropagation();openProductFromCard(link.closest(".product-card"));return;}
  if(card)openProductFromCard(card);
 });
 root.addEventListener("keydown",event=>{
  if(event.key!=="Enter"&&event.key!==" ")return;
  const card=event.target.closest(".product-card");
  if(card&&event.target===card){event.preventDefault();openProductFromCard(card);}
 });
}
function updateCard(card,p){
 const art=card.querySelector(".product-art"),content=card.querySelector(".product-content");
 if(!art||!content)return;
 const id=String(p.id||"");
 card.dataset.productId=id;
 card.setAttribute("role","button");
 card.setAttribute("tabindex","0");
 card.setAttribute("aria-label","View "+(p.name||"product")+" details and images");
 art.querySelector(".product-card-image")?.remove();
 art.classList.remove("has-product-image");
 if(p.imageUrl){
  const img=document.createElement("img");img.className="product-card-image";img.src=assetUrl(p.imageUrl);img.alt=(p.name||"Product")+" image";img.loading="eager";img.decoding="async";
  img.addEventListener("error",()=>{img.remove();art.classList.remove("has-product-image");console.warn("Product sample image failed to load:",p.name);});
  art.prepend(img);art.classList.add("has-product-image");
 }
 const title=content.querySelector("h3");if(title)title.textContent=p.name||"";
 let gallery=card.querySelector(".product-card-gallery");
 const galleryImages=[p.imageUrl,...(p.gallery||[])].map(assetUrl).filter(Boolean);
 if(galleryImages.length){
  if(!gallery){gallery=document.createElement("div");gallery.className="product-card-gallery";card.append(gallery);}
  gallery.setAttribute("aria-label",(p.name||"Product")+" image gallery");
  gallery.innerHTML='<div class="product-card-gallery-heading">SCREEN GALLERY <span>'+galleryImages.length+' IMAGES</span></div><div class="product-card-gallery-track">'+galleryImages.map((src,index)=>'<button type="button" class="product-card-gallery-thumb" aria-label="Open '+esc(p.name)+' image '+(index+1)+' of '+galleryImages.length+'"><img src="'+esc(src)+'" alt="'+esc(p.name)+' screenshot '+(index+1)+'" loading="eager" decoding="async"></button>').join("")+'</div>';
 }else if(gallery){gallery.remove();}
 const subtitle=content.querySelector(".product-subtitle");if(subtitle)subtitle.textContent=p.subtitle||"";
 const paragraphs=content.querySelectorAll(":scope > p:not(.product-subtitle)");if(paragraphs[0])paragraphs[0].textContent=p.description||"";
 const tags=content.querySelector(".product-tags");if(tags)tags.innerHTML=(p.tags||[]).map(x=>"<span>"+esc(x)+"</span>").join("");
 const link=content.querySelector(".product-link");
 if(link){link.removeAttribute("href");link.dataset.productDetail=id;link.textContent="View product details & images ↗";link.setAttribute("role","button");}
 let demoLink=content.querySelector(".product-live-demo");
 if(p.websiteUrl){
  if(!demoLink){demoLink=document.createElement("a");demoLink.className="product-link product-live-demo";demoLink.dataset.liveDemo="true";content.append(demoLink);}
  demoLink.href=p.websiteUrl;demoLink.target="_blank";demoLink.rel="noopener noreferrer";demoLink.textContent="Open Live Demo ↗";demoLink.setAttribute("aria-label","Open "+(p.name||"product")+" live demo in a new tab");
 }else if(demoLink){demoLink.remove();}
}
async function load(){
 try{const snap=await getDoc(doc(db,"publicCatalog","digitalProducts"));if(snap.exists()&&snap.data().published&&Array.isArray(snap.data().products)){const saved=snap.data().products.filter(p=>p.visible!==false);products=saved.map(p=>{const fallback=DEFAULT_DIGITAL_PRODUCTS.find(d=>String(d.id)===String(p.id));return fallback?{...fallback,...p,websiteUrl:fallback.websiteUrl,imageUrl:fallback.imageUrl,gallery:fallback.gallery||[]}:p});}}
 catch(e){console.warn("Product samples are using built-in defaults.",e)}
 if(root){const cards=[...root.querySelectorAll(".product-card")];products.forEach((p,i)=>{const card=cards.find(x=>x.querySelector("h3")?.textContent.trim().toLowerCase()===String(p.name||"").trim().toLowerCase())||cards[i];if(card)updateCard(card,p)});bind();}
}
load();
