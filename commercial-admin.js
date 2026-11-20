import { db } from "./firebase-client.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const DEFAULT_MODELS=[{"id":"one-time-sale","title":"One-Time Purchase","description":"Buy a ready-to-use website, app or software under a clearly defined licence.","priceLabel":"Request a quote","billingLabel":"One-time payment","features":["Defined product scope and licence","Delivery and handover terms","Optional hosting and maintenance quoted separately"],"active":true},{"id":"annual-rental","title":"Annual Rental","description":"Use a ZENURA product with a yearly subscription and renewal arrangement.","priceLabel":"Annual price on request","billingLabel":"Billed yearly · renews annually","features":["12-month usage licence","Renewal reminder before expiry","Hosting, support and backups as specified in the plan"],"active":true},{"id":"custom-development","title":"Custom Development","description":"Commission a website, mobile app, portal or business software tailored to your workflow.","priceLabel":"Custom quotation","billingLabel":"Milestone-based project billing","features":["Requirement discussion and scope document","Custom design, development and testing","Optional annual maintenance contract (AMC)"],"active":true}];
export async function setupCommercialModelsAdmin(auth){
 const area=document.getElementById("commercial-models-json"),editor=document.getElementById("commercial-models-editor"),status=document.getElementById("commercial-models-status"),ref=doc(db,"publicCatalog","commercialModels");
 const say=m=>status.textContent=m;
 const field=(label,value,oninput,type="text")=>{const wrap=document.createElement("label");wrap.className="catalogue-field";const title=document.createElement("span");title.textContent=label;const input=type==="textarea"?document.createElement("textarea"):document.createElement("input");if(type!=="textarea")input.type=type;input.value=value??"";input.addEventListener("input",()=>oninput(input.value));wrap.append(title,input);return wrap};
 function render(){let models;try{models=JSON.parse(area.value);if(!Array.isArray(models)||models.length!==3)throw Error()}catch{editor.textContent="Expected exactly three model records. Load defaults or correct the JSON.";return}
  editor.replaceChildren();
  models.forEach((m,i)=>{const card=document.createElement("article");card.className="commercial-model-editor";const h=document.createElement("h3");h.textContent=m.title||m.id;card.append(h);
   card.append(field("Model title",m.title,v=>{m.title=v;h.textContent=v||m.id;sync()}));
   card.append(field("Description",m.description,v=>{m.description=v;sync()},"textarea"));
   card.append(field("Public price label (e.g. ₹7,999 / year or Request a quote)",m.priceLabel,v=>{m.priceLabel=v;sync()}));
   card.append(field("Billing / renewal label",m.billingLabel,v=>{m.billingLabel=v;sync()}));
   card.append(field("Included terms (one per line)",(m.features||[]).join("\n"),v=>{m.features=v.split("\n").map(x=>x.trim()).filter(Boolean);sync()},"textarea"));
   const label=document.createElement("label");label.className="catalogue-visibility";const cb=document.createElement("input");cb.type="checkbox";cb.checked=m.active!==false;cb.addEventListener("change",()=>{m.active=cb.checked;sync()});label.append(cb,document.createTextNode(" Active on public website"));card.append(label);editor.append(card);
  });
  function sync(){area.value=JSON.stringify(models,null,2)}
 }
 async function load(){try{const snap=await getDoc(ref);area.value=JSON.stringify(snap.exists()?snap.data().models:DEFAULT_MODELS,null,2);render();say(snap.exists()?(snap.data().published?"Saved models loaded (published).":"Saved models are currently hidden."):"No saved settings yet. Safe defaults loaded; publish to display them.")}catch(e){say("Load failed: "+e.message)}}
 async function save(published){try{const models=JSON.parse(area.value);if(!Array.isArray(models)||models.length!==3)throw Error("Exactly three models are required.");const ids=["one-time-sale","annual-rental","custom-development"];models.forEach((m,i)=>{if(m.id!==ids[i]||!m.title?.trim()||!m.description?.trim()||!m.priceLabel?.trim()||!m.billingLabel?.trim()||!Array.isArray(m.features)||m.features.some(x=>typeof x!=="string")||typeof m.active!=="boolean")throw Error("Each model needs its fixed ID, title, description, price, billing label, feature list and active setting.")});await setDoc(ref,{models,published,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.email});say(published?"Engagement models published successfully.":"Engagement models hidden from the public website.")}catch(e){say("Save failed: "+e.message)}}
 document.getElementById("commercial-load").addEventListener("click",load);
 document.getElementById("commercial-defaults").addEventListener("click",()=>{area.value=JSON.stringify(DEFAULT_MODELS,null,2);render();say("Safe defaults loaded. Publish to save.")});
 area.addEventListener("input",()=>render());
 document.getElementById("commercial-publish").addEventListener("click",()=>save(true));
 document.getElementById("commercial-hide").addEventListener("click",()=>save(false));
 await load();
}
