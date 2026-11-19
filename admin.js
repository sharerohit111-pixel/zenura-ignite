import { ADMIN_EMAIL, isFirebaseConfigured } from "./firebase-config.js";
const loginPanel=document.getElementById("login-panel"), dashboard=document.getElementById("dashboard");
const loginError=document.getElementById("login-error"), dashboardError=document.getElementById("dashboard-error");
const loginButton=document.getElementById("login"), logoutButton=document.getElementById("logout");
let allEnquiries=[];
const esc=value=>String(value??"");
function showError(el,message){el.textContent=message||"";}
function dateLabel(value){try{return value?.toDate?value.toDate().toLocaleString():"Date unavailable";}catch{return "Date unavailable";}}
function render(){
 const q=document.getElementById("search").value.trim().toLowerCase(),status=document.getElementById("status-filter").value;
 const filtered=allEnquiries.filter(x=>{const hay=[x.name,x.reply,x.projectType,x.budget,x.message].map(esc).join(" ").toLowerCase();return(!q||hay.includes(q))&&(status==="all"||x.status===status)});
 document.getElementById("total").textContent=allEnquiries.length;document.getElementById("new-count").textContent=allEnquiries.filter(x=>x.status==="new").length;document.getElementById("progress-count").textContent=allEnquiries.filter(x=>x.status==="in-progress").length;document.getElementById("done-count").textContent=allEnquiries.filter(x=>x.status==="completed").length;
 const host=document.getElementById("enquiries");host.replaceChildren();if(!filtered.length){const p=document.createElement("p");p.className="muted";p.textContent="No enquiries match this view.";host.append(p);return}
 for(const item of filtered){const card=document.createElement("article");card.className="enquiry";const head=document.createElement("div");head.className="enquiry-head";const identity=document.createElement("div"),h=document.createElement("h3");h.textContent=esc(item.name)||"Unnamed enquiry";const meta=document.createElement("div");meta.className="meta";meta.textContent=esc(item.reply)+" · "+dateLabel(item.createdAt);identity.append(h,meta);const select=document.createElement("select");select.className="status";select.setAttribute("aria-label","Enquiry status");[["new","New"],["in-progress","In progress"],["completed","Completed"]].forEach(([v,label])=>{const o=document.createElement("option");o.value=v;o.textContent=label;select.append(o)});select.value=["new","in-progress","completed"].includes(item.status)?item.status:"new";select.addEventListener("change",()=>changeStatus(item.id,select.value,select));head.append(identity,select);const details=document.createElement("p");details.textContent=esc(item.projectType)+" · Budget: "+esc(item.budget);const message=document.createElement("p");message.className="message";message.textContent=esc(item.message);card.append(head,details,message);host.append(card)}
}
async function changeStatus(id,status,control){try{const {db}=await import("./firebase-client.js");const {doc,updateDoc}=await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");await updateDoc(doc(db,"enquiries",id),{status});const item=allEnquiries.find(x=>x.id===id);if(item)item.status=status;render()}catch(error){showError(dashboardError,"Could not update status: "+error.message);control.value=allEnquiries.find(x=>x.id===id)?.status||"new"}}
async function loadEnquiries(){try{const {db}=await import("./firebase-client.js");const {collection,getDocs,orderBy,query}=await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");const snap=await getDocs(query(collection(db,"enquiries"),orderBy("createdAt","desc")));allEnquiries=snap.docs.map(d=>({id:d.id,...d.data()}));render();showError(dashboardError,"")}catch(error){showError(dashboardError,"Could not load enquiries: "+error.message)}}
async function setupCatalogueAdmin(auth){
 const {DEFAULT_SOLUTIONS}=await import("./solutions-catalogue-data.js");
 const {db}=await import("./firebase-client.js");
 const fs=await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
 const area=document.getElementById("catalogue-json"),status=document.getElementById("catalogue-status");
 const say=m=>status.textContent=m;
 const ref=fs.doc(db,"publicCatalog","businessSolutions");
 const editor=document.getElementById("catalogue-visual-editor");
 const field=(label,value,oninput,type="text")=>{const wrap=document.createElement("label");wrap.className="catalogue-field";const title=document.createElement("span");title.textContent=label;const input=type==="textarea"?document.createElement("textarea"):document.createElement("input");if(type!=="textarea")input.type=type;input.value=value??"";input.addEventListener("input",()=>oninput(input.value));wrap.append(title,input);return wrap};
 function renderVisualEditor(){
  let data;try{data=JSON.parse(area.value)}catch{editor.textContent="JSON ठीक करें या saved catalogue दोबारा load करें।";return}
  editor.replaceChildren();
  data.forEach((category,ci)=>{
   const section=document.createElement("section");section.className="catalogue-edit-category";
   const heading=document.createElement("h3");heading.textContent="Category: "+(category.name||category.id);section.append(heading);
   section.append(field("Category name",category.name,v=>{category.name=v;heading.textContent="Category: "+v;sync()}));
   section.append(field("Category description",category.description,v=>{category.description=v;sync()}));
   section.append(field("Category icon",category.icon,v=>{category.icon=v;sync()}));
   (category.products||[]).forEach((product,pi)=>{
    const card=document.createElement("article");card.className="catalogue-edit-product";
    const h=document.createElement("h4");h.textContent=product.name||"New product";card.append(h);
    card.append(field("Product name",product.name,v=>{product.name=v;h.textContent=v||"New product";sync()}));
    card.append(field("Product description",product.desc,v=>{product.desc=v;sync()}));
    const visibility=document.createElement("label");visibility.className="catalogue-visibility";const visible=document.createElement("input");visible.type="checkbox";visible.checked=product.visible!==false;visible.addEventListener("change",()=>{product.visible=visible.checked;sync()});visibility.append(visible,document.createTextNode(" Show on public website"));card.append(visibility);
    const plans=document.createElement("div");plans.className="catalogue-edit-plans";
    for(const [key,label] of [["silver","Silver Plan"],["gold","Golden Plan"]]){
     product[key]=product[key]||{price:0,features:[]};const plan=product[key],box=document.createElement("div");box.className="catalogue-edit-plan";
     const title=document.createElement("strong");title.textContent=label;box.append(title);
     box.append(field(label+" price (₹)",plan.price,v=>{plan.price=Number(v)||0;sync()},"number"));
     box.append(field(label+" features (one per line)",(plan.features||[]).join("\n"),v=>{plan.features=v.split("\n").map(x=>x.trim()).filter(Boolean);sync()},"textarea"));
     plans.append(box);
    }
    card.append(plans);
    const remove=document.createElement("button");remove.type="button";remove.className="secondary";remove.textContent="Remove product";remove.addEventListener("click",()=>{category.products.splice(pi,1);sync();renderVisualEditor()});card.append(remove);
    section.append(card);
   });
   const add=document.createElement("button");add.type="button";add.className="secondary";add.textContent="+ Add product to "+(category.name||"category");add.addEventListener("click",()=>{category.products.push({id:"new-product-"+Date.now(),name:"New product",icon:"✦",desc:"",silver:{price:0,features:[]},gold:{price:0,features:[]}});sync();renderVisualEditor()});section.append(add);
   const removeCategory=document.createElement("button");removeCategory.type="button";removeCategory.className="secondary";removeCategory.textContent="Remove category";removeCategory.addEventListener("click",()=>{data.splice(ci,1);sync();renderVisualEditor()});section.append(removeCategory);
   editor.append(section);
  });
  const addCategory=document.createElement("button");addCategory.type="button";addCategory.className="primary";addCategory.textContent="+ Add category";addCategory.addEventListener("click",()=>{data.push({id:"new-category-"+Date.now(),name:"New category",icon:"✦",description:"",products:[]});sync();renderVisualEditor()});editor.append(addCategory);
  function sync(){area.value=JSON.stringify(data,null,2)}
 }
 async function loadSaved(){try{const snap=await fs.getDoc(ref);area.value=JSON.stringify(snap.exists()?snap.data().categories:DEFAULT_SOLUTIONS,null,2);renderVisualEditor();say(snap.exists()?(snap.data().published?"Saved catalogue loaded (published).":"Saved catalogue is hidden."):"No saved catalogue yet. Defaults loaded; publish to make them live.")}catch(e){say("Load failed: "+e.message)}}
 area.addEventListener("input",()=>{try{renderVisualEditor()}catch{}});
 document.getElementById("catalogue-load").addEventListener("click",loadSaved);
 document.getElementById("catalogue-defaults").addEventListener("click",()=>{area.value=JSON.stringify(DEFAULT_SOLUTIONS,null,2);renderVisualEditor();say("Default catalogue loaded in editor. Publish to save it.")});
 async function publish(published){try{const categories=JSON.parse(area.value);if(!Array.isArray(categories)||!categories.length)throw new Error("Catalogue must be a non-empty array.");for(const c of categories){if(!c.id||!c.name||!Array.isArray(c.products))throw new Error("Every category needs id, name and products.");for(const p of c.products){if(!p.id||!p.name||!p.silver||!p.gold||!Array.isArray(p.silver.features)||!Array.isArray(p.gold.features))throw new Error("Each product needs id, name, Silver and Golden plans with feature lists.");for(const plan of [p.silver,p.gold])if(!Number.isFinite(Number(plan.price))||Number(plan.price)<0)throw new Error("Plan prices must be zero or greater.")}}await fs.setDoc(ref,{categories,published,updatedAt:fs.serverTimestamp(),updatedBy:auth.currentUser.email});say(published?"Published successfully. Public website will show this catalogue.":"Catalogue hidden from public website.");}catch(e){say("Save failed: "+e.message)}}
 document.getElementById("catalogue-publish").addEventListener("click",()=>publish(true));
 document.getElementById("catalogue-hide").addEventListener("click",()=>publish(false));
 await loadSaved();
}
if(!isFirebaseConfigured()){loginButton.disabled=true;loginButton.textContent="Firebase setup required";showError(loginError,"Firebase configuration is required for administrator login.")}else{
 const [{auth,googleProvider},{onAuthStateChanged,signInWithPopup,signOut}]=await Promise.all([import("./firebase-client.js"),import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")]);
 loginButton.addEventListener("click",async()=>{showError(loginError,"");try{await signInWithPopup(auth,googleProvider)}catch(e){showError(loginError,e.message)}});
 logoutButton.addEventListener("click",()=>signOut(auth));
 onAuthStateChanged(auth,async user=>{if(user&&user.email===ADMIN_EMAIL&&user.emailVerified){loginPanel.hidden=true;dashboard.hidden=false;document.getElementById("identity").textContent="Signed in as "+user.email;await Promise.all([loadEnquiries(),setupCatalogueAdmin(auth)]);document.getElementById("solutions-admin").hidden=false}else{if(user)await signOut(auth);loginPanel.hidden=false;dashboard.hidden=true;if(user)showError(loginError,"This Google account is not authorized.")}});
 document.getElementById("search").addEventListener("input",render);document.getElementById("status-filter").addEventListener("change",render);
}
