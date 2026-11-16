import { ADMIN_EMAIL, isFirebaseConfigured } from "./firebase-config.js";
const loginPanel=document.getElementById("login-panel"), dashboard=document.getElementById("dashboard");
const loginError=document.getElementById("login-error"), dashboardError=document.getElementById("dashboard-error");
const loginButton=document.getElementById("login"), logoutButton=document.getElementById("logout");
let allEnquiries=[];
const esc=(value)=>String(value??"");
function showError(el,message){el.textContent=message||"";}
function dateLabel(value){try{return value?.toDate?value.toDate().toLocaleString(): "Date unavailable";}catch{return "Date unavailable";}}
function render(){
 const q=document.getElementById("search").value.trim().toLowerCase();
 const status=document.getElementById("status-filter").value;
 const filtered=allEnquiries.filter(x=>{
  const hay=[x.name,x.reply,x.projectType,x.budget,x.message].map(esc).join(" ").toLowerCase();
  return (!q||hay.includes(q))&&(status==="all"||x.status===status);
 });
 document.getElementById("total").textContent=allEnquiries.length;
 document.getElementById("new-count").textContent=allEnquiries.filter(x=>x.status==="new").length;
 document.getElementById("progress-count").textContent=allEnquiries.filter(x=>x.status==="in-progress").length;
 document.getElementById("done-count").textContent=allEnquiries.filter(x=>x.status==="completed").length;
 const host=document.getElementById("enquiries");host.replaceChildren();
 if(!filtered.length){const p=document.createElement("p");p.className="muted";p.textContent="No enquiries match this view.";host.append(p);return;}
 for(const item of filtered){
  const card=document.createElement("article");card.className="enquiry";
  const head=document.createElement("div");head.className="enquiry-head";
  const identity=document.createElement("div");const h=document.createElement("h3");h.textContent=esc(item.name)||"Unnamed enquiry";
  const meta=document.createElement("div");meta.className="meta";meta.textContent=esc(item.reply)+" · "+dateLabel(item.createdAt);
  identity.append(h,meta);
  const select=document.createElement("select");select.className="status";select.setAttribute("aria-label","Enquiry status");
  [["new","New"],["in-progress","In progress"],["completed","Completed"]].forEach(([v,label])=>{const o=document.createElement("option");o.value=v;o.textContent=label;select.append(o);});
  select.value=["new","in-progress","completed"].includes(item.status)?item.status:"new";
  select.addEventListener("change",()=>changeStatus(item.id,select.value,select));
  head.append(identity,select);
  const details=document.createElement("p");details.textContent=esc(item.projectType)+" · Budget: "+esc(item.budget);
  const message=document.createElement("p");message.className="message";message.textContent=esc(item.message);
  card.append(head,details,message);host.append(card);
 }
}
async function changeStatus(id,status,control){
 try{const {db}=await import("./firebase-client.js");const {doc,updateDoc}=await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");await updateDoc(doc(db,"enquiries",id),{status});const item=allEnquiries.find(x=>x.id===id);if(item)item.status=status;render();}
 catch(error){showError(dashboardError,"Could not update status: "+error.message);control.value=allEnquiries.find(x=>x.id===id)?.status||"new";}
}
async function loadEnquiries(){
 try{
  const {db}=await import("./firebase-client.js");
  const {collection,getDocs,orderBy,query}=await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");
  const snap=await getDocs(query(collection(db,"enquiries"),orderBy("createdAt","desc")));
  allEnquiries=snap.docs.map(d=>({id:d.id,...d.data()}));render();showError(dashboardError,"");
 }catch(error){showError(dashboardError,"Could not load enquiries: "+error.message);}
}
if(!isFirebaseConfigured()){
 loginButton.disabled=true;loginButton.textContent="Firebase setup required";
 showError(loginError,"Add the separate ZENURA Firebase Web App configuration in firebase-config.js to activate admin login.");
}else{
 const [{auth,googleProvider},{onAuthStateChanged,signInWithPopup,signOut}]=await Promise.all([
  import("./firebase-client.js"),import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
 ]);
 loginButton.addEventListener("click",async()=>{showError(loginError,"");try{await signInWithPopup(auth,googleProvider);}catch(e){showError(loginError,e.message);}});
 logoutButton.addEventListener("click",()=>signOut(auth));
 onAuthStateChanged(auth,async user=>{
  if(user&&user.email===ADMIN_EMAIL&&user.emailVerified){
   loginPanel.hidden=true;dashboard.hidden=false;document.getElementById("identity").textContent="Signed in as "+user.email;await loadEnquiries();
  }else{
   if(user)await signOut(auth);
   loginPanel.hidden=false;dashboard.hidden=true;
   if(user)showError(loginError,"This Google account is not authorized.");
  }
 });
 document.getElementById("search").addEventListener("input",render);
 document.getElementById("status-filter").addEventListener("change",render);
}
