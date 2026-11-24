import { supabase } from "./supabase-client.js";
const gateway=(document.querySelector('meta[name="market-gateway-url"]')?.content||"").trim().replace(/\/+$/,"");
const $=id=>document.getElementById(id);
let page=1;
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;}
function setStatus(text,error=false){$("status").textContent=text;$("status").classList.toggle("error",error);}
async function api(path,options={}){
 const {data,error}=await supabase.auth.getSession();if(error)throw error;
 const token=data.session?.access_token;if(!token)throw new Error("Sign in with your S-TRADE account first.");
 if(!gateway)throw new Error("Market gateway URL is not configured.");
 const response=await fetch(gateway+"/s-trade"+path,{...options,headers:{Authorization:"Bearer "+token,Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},cache:"no-store"});
 const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||"Request failed ("+response.status+").");return payload;
}
function metric(label,value){const el=node("div","metric");el.append(node("small","",label),node("b","",value));return el;}
async function loadOverview(){
 const data=await api("/admin/overview");$("metrics").replaceChildren(
  metric("ACTIVE PRICE ALERTS",data.activePriceAlerts),metric("UNREAD NOTIFICATIONS",data.unreadNotifications),metric("USER DIRECTORY","Available")
 );
 const providers=$("providers");providers.replaceChildren();
 (data.providers||[]).forEach(p=>{const row=node("div","item"),left=node("div");left.append(node("b","",p.provider.toUpperCase()),node("small","", "Checked "+new Date(p.checked_at).toLocaleString()+" · "+(p.latency_ms??"—")+" ms"));row.append(left,node("span","pill "+(p.status==="healthy"?"": "down"),p.status));providers.append(row);});
 if(!providers.childElementCount)providers.append(node("small","muted","No provider heartbeat has been recorded yet."));
 const controls=$("controls");controls.replaceChildren();
 const known=["new_orders_enabled","price_alerts_enabled","provider_upstox_enabled"];
 const existing=new Map((data.controls||[]).map(c=>[c.control_key,c]));
 known.forEach(key=>{const current=existing.get(key),enabled=current?current.enabled:true,row=node("div","item"),left=node("div");left.append(node("b","",key.replaceAll("_"," ").toUpperCase()),node("small","",current?.reason||"Default: enabled"));const button=node("button","",enabled?"PAUSE":"ENABLE");button.addEventListener("click",()=>changeControl(key,!enabled));row.append(left,button);controls.append(row);});
}
async function changeControl(key,enabled){
 const reason=prompt("Enter the operational reason (minimum 8 characters):");if(!reason||reason.trim().length<8)return;
 await api("/admin/controls/"+encodeURIComponent(key),{method:"POST",body:JSON.stringify({enabled,reason:reason.trim()})});
 setStatus("Operational control updated and audit events recorded.");await loadOverview();await loadAudit();
}
async function loadUsers(reset=false){
 if(reset)page=1;const data=await api("/admin/users?page="+page);const list=$("users");if(reset)list.replaceChildren();
 data.users.forEach(u=>{const row=node("div","item"),left=node("div");left.append(node("b","",u.email||u.id),node("small","",u.id+" · joined "+(u.createdAt?new Date(u.createdAt).toLocaleDateString():"—")));const button=node("button","",u.bannedUntil?"RESTORE":"SUSPEND");button.addEventListener("click",async()=>{const reason=prompt("Reason for "+(u.bannedUntil?"restoring":"suspending")+" this account (minimum 8 characters):");if(!reason||reason.trim().length<8)return;await api("/admin/users/"+u.id+"/status",{method:"POST",body:JSON.stringify({disabled:!u.bannedUntil,reason:reason.trim()})});setStatus("User status updated and audit events recorded.");await loadUsers(true);await loadAudit();});row.append(left,button);list.append(row);});
 if(!data.users.length&&reset)list.append(node("small","muted","No users on this page."));
}
async function loadAudit(){const data=await api("/admin/audit?limit=50"),list=$("audit");list.replaceChildren();data.events.forEach(e=>{const row=node("div","item"),left=node("div");left.append(node("b","",e.action+" · "+e.outcome),node("small","",e.target_type+" "+(e.target_id||"")+" · "+e.reason+" · "+new Date(e.created_at).toLocaleString()));row.append(left);list.append(row);});if(!data.events.length)list.append(node("small","muted","No administrative actions recorded."));}
async function refresh(){
 try{setStatus("Verifying administrator authorization…");await loadOverview();await loadUsers(true);await loadAudit();setStatus("Administrator session verified by the backend. All displayed data is server-authorized.");}
 catch(error){setStatus(error.message||"Admin console unavailable.",true);$("metrics").replaceChildren();$("providers").replaceChildren();$("controls").replaceChildren();$("users").replaceChildren();$("audit").replaceChildren();}
}
$("refresh").addEventListener("click",refresh);
$("more-users").addEventListener("click",async()=>{try{page++;await loadUsers(false);}catch(e){setStatus(e.message,true);}});
supabase.auth.onAuthStateChange(()=>refresh());
refresh();
