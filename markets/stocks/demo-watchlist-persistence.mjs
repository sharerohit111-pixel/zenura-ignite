import {supabase} from "./supabase-client.js";

const PRIVATE_LISTS=["My Stocks","Banking","NIFTY","F&O"];
const MAX_ITEMS=50;
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};

export function mountPrivateWatchlists(host,{model,fetchImpl=fetch,supabaseClient=supabase,gatewayUrl}={}){
 const catalog=model?.market?.instruments;
 if(!Array.isArray(catalog))throw new Error("CANONICAL_MOCK_CATALOG_REQUIRED");
 const gateway=(gatewayUrl??document.querySelector('meta[name="market-gateway-url"]')?.content??"").trim().replace(/\/+$/,"");
 const panel=make("section","catalog-panel"),title=make("h3","","Private Watchlists");
 const disclosure=make("p","sub","Account-saved lists · private to the signed-in user · separate from Demo Watchlists");
 const controls=make("div","catalog-controls"),listSelect=make("select"),instrumentSelect=make("select");
 PRIVATE_LISTS.forEach(name=>{const o=make("option","",name);o.value=name;listSelect.append(o);});
 catalog.forEach(item=>{const o=make("option","",item.symbol+" · "+item.exchange+" · "+item.assetClass);o.value=item.instrumentKey;instrumentSelect.append(o);});
 const add=make("button","catalog-add","SAVE TO PRIVATE LIST");add.type="button";
 const status=make("p","sub","Checking sign-in session…"),rowsHost=make("div","catalog-results");
 const listField=make("label","catalog-field"),listLabel=make("span","","Private list"),instrumentField=make("label","catalog-field");
 listField.append(listLabel,listSelect);instrumentField.append(make("span","","Add canonical MOCK instrument"),instrumentSelect);
 controls.append(listField,instrumentField,add);panel.append(title,disclosure,controls,status,rowsHost);host.append(panel);
 let userId=null,items=[],requestSeq=0,editSeq=0,authSubscription=null,disposed=false;
 const currentName=()=>listSelect.value;
 const session=async()=>{const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;return data.session||null;};
 const currentUser=async()=>{const s=await session();return s?.user?.id?{id:s.user.id,token:s.access_token}:null;};
 const currentCatalogItem=key=>catalog.find(x=>x.instrumentKey===key);
 function render(){
  rowsHost.textContent="";
  const present=new Set(items.map(x=>x.instrument_key));
  [...instrumentSelect.options].forEach(o=>{o.disabled=present.has(o.value);});
  add.disabled=!userId||!gateway||!instrumentSelect.value||present.has(instrumentSelect.value)||items.length>=MAX_ITEMS;
  if(!items.length){rowsHost.append(make("p","empty","No saved instruments in this private list."));return;}
  const table=make("table"),head=make("thead"),hr=make("tr"),body=make("tbody");
  ["INSTRUMENT","EXCHANGE","TYPE","ORDER","REMOVE"].forEach(x=>hr.append(make("th","",x)));head.append(hr);
  items.forEach((item,index)=>{
   const canonical=currentCatalogItem(item.instrument_key),tr=make("tr");
   tr.append(make("td","",canonical?.symbol||item.trading_symbol||item.instrument_key),make("td","",canonical?.exchange||item.exchange||"—"),make("td","",canonical?.assetClass||item.instrument_type||"—"));
   const order=make("td"),up=make("button","catalog-action","↑"),down=make("button","catalog-action","↓");
   up.type=down.type="button";up.disabled=index===0;down.disabled=index===items.length-1;
   up.setAttribute("aria-label","Move "+(canonical?.symbol||item.trading_symbol)+" up");down.setAttribute("aria-label","Move "+(canonical?.symbol||item.trading_symbol)+" down");
   up.addEventListener("click",()=>mutate(next=>{[next[index-1],next[index]]=[next[index],next[index-1]];}));
   down.addEventListener("click",()=>mutate(next=>{[next[index],next[index+1]]=[next[index+1],next[index]];}));
   order.append(up,down);const removeCell=make("td"),remove=make("button","catalog-action","REMOVE");remove.type="button";remove.addEventListener("click",()=>mutate(next=>next.splice(index,1)));
   removeCell.append(remove);tr.append(order,removeCell);body.append(tr);
  });
  table.append(head,body);const wrap=make("div","table-wrap");wrap.tabIndex=0;wrap.setAttribute("role","region");wrap.setAttribute("aria-label","Private saved watchlist");wrap.append(table);rowsHost.append(wrap);
 }
 function active(seq,uid,name,edit){return !disposed&&seq===requestSeq&&uid===userId&&name===currentName()&&(edit===undefined||edit===editSeq);}
 async function load(){
  const seq=++requestSeq,name=currentName(),snapshot=await currentUser();
  if(disposed||seq!==requestSeq)return;
  if(!snapshot){userId=null;items=[];status.textContent="Sign in to restore and save private watchlists. Demo Watchlists remain available without sign-in.";render();return;}
  if(!gateway){userId=snapshot.id;items=[];status.textContent="Signed in, but private watchlists are unavailable until the market gateway URL is configured.";render();return;}
  userId=snapshot.id;items=[];status.textContent="Restoring private watchlist…";render();
  try{
   const response=await fetchImpl(gateway+"/watchlist?name="+encodeURIComponent(name),{headers:{Authorization:"Bearer "+snapshot.token,Accept:"application/json"},cache:"no-store"});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Private watchlist could not be loaded.");
   const latest=await currentUser();if(!active(seq,snapshot.id,name)||latest?.id!==snapshot.id)return;
   items=(data.items||[]).filter(x=>typeof x.instrument_key==="string"&&currentCatalogItem(x.instrument_key));
   status.textContent=items.length+" / 50 saved to your account · private · restored from server";render();
  }catch(error){if(active(seq,snapshot.id,name)){status.textContent=error.message||"Private watchlist restore failed.";render();}}
 }
 async function persist(next,seq,uid,name){
  try{
   const snapshot=await currentUser();if(!active(seq,uid,name)||snapshot?.id!==uid)return false;
   const response=await fetchImpl(gateway+"/watchlist",{method:"PUT",headers:{Authorization:"Bearer "+snapshot.token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({name,instrumentKeys:next.map(x=>x.instrument_key)}),cache:"no-store"});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Private watchlist save failed.");
   const latest=await currentUser();if(!active(seq,uid,name)||latest?.id!==uid)return false;
   status.textContent=data.count+" / 50 saved to your account · private";return true;
  }catch(error){if(active(seq,uid,name))status.textContent=error.message||"Private watchlist save failed.";return false;}
 }
 async function mutate(change){
  if(!userId||!gateway)return;
  const uid=userId,name=currentName(),before=items.slice(),next=items.slice();change(next);
  if(next.length>MAX_ITEMS||new Set(next.map(x=>x.instrument_key)).size!==next.length)return;
  items=next;const edit=++editSeq,seq=++requestSeq;render();status.textContent="Saving private watchlist…";
  if(!await persist(next,seq,uid,name)&&active(seq,uid,name,edit)){items=before;render();}
 }
 add.addEventListener("click",()=>{
  const key=instrumentSelect.value,item=currentCatalogItem(key);
  if(!item||items.some(x=>x.instrument_key===key)||items.length>=MAX_ITEMS)return;
  mutate(next=>next.push({instrument_key:key,trading_symbol:item.symbol,name:item.symbol,exchange:item.exchange,instrument_type:item.assetClass}));
 });
 listSelect.addEventListener("change",()=>{requestSeq++;editSeq++;items=[];render();load();});
 const authResult=supabaseClient.auth.onAuthStateChange((_event,newSession)=>{
  const nextId=newSession?.user?.id||null;
  if(nextId!==userId){requestSeq++;editSeq++;userId=nextId;items=[];status.textContent=nextId?"Account changed · restoring its private watchlist…":"Signed out · private watchlist hidden.";render();queueMicrotask(load);}
 });
 authSubscription=authResult?.data?.subscription||null;
 load().catch(error=>{status.textContent=error.message||"Private watchlist unavailable.";});
 return Object.freeze({refresh:load,dispose(){disposed=true;requestSeq++;authSubscription?.unsubscribe?.();}});
}
