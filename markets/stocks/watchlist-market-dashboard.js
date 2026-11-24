(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 if(root&&root.document)root.ZENURA_MARKET_DASHBOARD=api.init(root.document);
})(typeof window!=="undefined"?window:null,function(){
 "use strict";
 function validateFixture(v){
  if(!v||v.schemaVersion!=="1.0.0"||v.mode!=="MOCK"||v.simulated!==true||v.meta?.source!=="SYNTHETIC_FIXTURE"||v.data?.dataType!=="SYNTHETIC_MOCK"||!Array.isArray(v.data.indices)||!Array.isArray(v.data.stocks)||!Array.isArray(v.data.exchangeStatuses)||!v.data.watchlists||typeof v.data.watchlists!=="object")throw Error("Invalid synthetic market dashboard fixture.");
  if([...v.data.indices,...v.data.stocks].some(x=>!x||typeof x.symbol!=="string"||!Number.isFinite(x.lastPrice)||!Number.isFinite(x.changePercent)))throw Error("Invalid synthetic market row.");
  if(Object.values(v.data.watchlists).some(x=>!Array.isArray(x)||x.length>50||x.some(s=>typeof s!=="string")))throw Error("Invalid synthetic watchlist fixture.");
  return v;
 }
 function sortedMovers(rows,direction="up",limit=3){return rows.slice().sort((a,b)=>(direction==="down"?1:-1)*(a.changePercent-b.changePercent)||a.symbol.localeCompare(b.symbol)).slice(0,limit);}
 function moveWatchlistItem(items,index,delta){const next=Array.isArray(items)?items.slice():[],target=index+delta;if(!Number.isInteger(index)||!Number.isInteger(delta)||index<0||index>=next.length||target<0||target>=next.length)return next;[next[index],next[target]]=[next[target],next[index]];return next;}
 function addWatchlistItem(items,symbol){if(!Array.isArray(items)||typeof symbol!=="string"||!symbol||items.includes(symbol)||items.length>=50)return Array.isArray(items)?items.slice():[];return [...items,symbol];}
 function removeWatchlistItem(items,symbol){return Array.isArray(items)?items.filter(x=>x!==symbol):[];}
 function money(v){return "₹"+Number(v).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
 function init(doc){
  const root=doc.getElementById("mock-market-dashboard");if(!root)return null;
  const el=id=>doc.getElementById(id),status=el("market-status-cards"),indices=el("market-index-grid"),gainers=el("market-gainers"),losers=el("market-losers"),detail=el("market-stock-detail"),foot=el("market-data-footnote"),listSelect=el("demo-watchlist-select"),stockSelect=el("demo-watchlist-stock-select"),addButton=el("demo-watchlist-add"),listBody=el("demo-watchlist-items");
  const make=(tag,cls,txt)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
  let fixtureData=null,activeList="";
  function stockDetail(s){detail.textContent="";const h=make("div","market-block-head");h.append(make("h3","",s.name+" · "+s.symbol),make("span","",s.exchange+" · SYNTHETIC"));detail.append(h);const fields=[["Last price",money(s.lastPrice)],["Change",money(s.change)+" ("+s.changePercent.toFixed(2)+"%)"],["Open",money(s.open)],["Previous close",money(s.previousClose)],["Day high",money(s.high)],["Day low",money(s.low)],["Volume",s.volume.toLocaleString("en-IN")],["52W high",money(s.week52High)],["52W low",money(s.week52Low)],["Sector",s.sector]];const grid=make("div","market-detail-grid");fields.forEach(([k,v])=>{const c=make("div");c.append(make("small","",k),make("b","",v));grid.append(c);});detail.append(grid);}
  function renderDemoWatchlist(){
   if(!fixtureData)return;
   const symbols=fixtureData.watchlists[activeList]||[];listBody.textContent="";
   if(!symbols.length)listBody.append(make("p","market-dashboard-empty","No demo stocks in this list."));
   symbols.forEach((symbol,index)=>{
    const stock=fixtureData.stocks.find(s=>s.symbol===symbol);if(!stock)return;
    const row=make("div","market-demo-watch-row"),pick=make("button","market-demo-watch-pick",symbol+" · "+money(stock.lastPrice));
    pick.type="button";pick.addEventListener("click",()=>stockDetail(stock));
    const order=make("div","market-demo-watch-order");
    const up=make("button","market-demo-watch-action","↑");up.type="button";up.disabled=index===0;up.setAttribute("aria-label","Move "+symbol+" up");up.addEventListener("click",()=>{fixtureData.watchlists[activeList]=moveWatchlistItem(symbols,index,-1);renderDemoWatchlist();});
    const down=make("button","market-demo-watch-action","↓");down.type="button";down.disabled=index===symbols.length-1;down.setAttribute("aria-label","Move "+symbol+" down");down.addEventListener("click",()=>{fixtureData.watchlists[activeList]=moveWatchlistItem(symbols,index,1);renderDemoWatchlist();});
    const remove=make("button","market-demo-watch-action","REMOVE");remove.type="button";remove.addEventListener("click",()=>{fixtureData.watchlists[activeList]=removeWatchlistItem(symbols,symbol);renderDemoWatchlist();});
    order.append(up,down,remove);row.append(pick,order);listBody.append(row);
   });
   const present=new Set(symbols);[...stockSelect.options].forEach(o=>{o.disabled=present.has(o.value);});addButton.disabled=!stockSelect.value||present.has(stockSelect.value)||symbols.length>=50;
  }
  function render(raw){
   const f=validateFixture(raw),d=f.data;fixtureData={stocks:d.stocks,watchlists:Object.fromEntries(Object.entries(d.watchlists).map(([k,v])=>[k,v.slice()]))};
   status.textContent="";d.exchangeStatuses.forEach(s=>{const c=make("div","market-status-card");c.append(make("small","",s.exchange+" SAMPLE STATUS"),make("b","",s.status.replace("MOCK_","MOCK ")),make("span","",s.label));status.append(c);});
   indices.textContent="";d.indices.forEach(s=>{const c=make("div","market-index-card");c.append(make("small","",s.exchange),make("b","",s.symbol),make("strong","",money(s.lastPrice)),make("span",s.changePercent>=0?"positive":"negative",money(s.change)+" · "+s.changePercent.toFixed(2)+"%"));indices.append(c);});
   function moverList(target,rows){target.textContent="";rows.forEach(s=>{const b=make("button","market-mover-row");b.type="button";b.append(make("span","market-mover-name",s.symbol+" · "+s.name),make("span","market-mover-price",money(s.lastPrice)),make("b",s.changePercent>=0?"positive":"negative",(s.changePercent>0?"+":"")+s.changePercent.toFixed(2)+"%"));b.addEventListener("click",()=>stockDetail(s));target.append(b);});}
   moverList(gainers,sortedMovers(d.stocks,"up",3));moverList(losers,sortedMovers(d.stocks,"down",3));if(d.stocks[0])stockDetail(d.stocks[0]);
   listSelect.textContent="";Object.keys(d.watchlists).forEach(name=>listSelect.append(make("option","",name)));activeList=listSelect.value;
   stockSelect.textContent="";d.stocks.forEach(s=>{const o=make("option","",s.symbol+" · "+s.name);o.value=s.symbol;stockSelect.append(o);});
   listSelect.addEventListener("change",()=>{activeList=listSelect.value;renderDemoWatchlist();});
   stockSelect.addEventListener("change",renderDemoWatchlist);\n   addButton.addEventListener("click",()=>{if(!fixtureData||!stockSelect.value)return;fixtureData.watchlists[activeList]=addWatchlistItem(fixtureData.watchlists[activeList],stockSelect.value);renderDemoWatchlist();});
   renderDemoWatchlist();foot.textContent="Fixture source: local JSON · "+f.asOf+" · deterministic synthetic values · not live prices or official exchange status. Demo watchlist edits remain in memory for this page session.";
  }
  fetch("./mock/market-dashboard.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("Demo market fixture unavailable.");return r.json();}).then(render).catch(e=>{status.textContent="Demo dashboard unavailable: "+e.message;});
  return Object.freeze({render,validateFixture,moveWatchlistItem,addWatchlistItem,removeWatchlistItem});
 }
 return Object.freeze({validateFixture,sortedMovers,moveWatchlistItem,addWatchlistItem,removeWatchlistItem,money,init});
});