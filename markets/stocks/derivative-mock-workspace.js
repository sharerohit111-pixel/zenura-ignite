(function() {
  "use strict";
  const root = document.getElementById("derivative-demo-workspace");
  if (!root) return;
  const $ = id => document.getElementById(id);
  const asset=$("derivative-demo-asset"),futureSelect=$("derivative-demo-future");
  const underlying=$("derivative-demo-underlying"),expiry=$("derivative-demo-expiry");
  const optionType=$("derivative-demo-option-type"),strike=$("derivative-demo-strike");
  const orderType=$("derivative-demo-order-type"),lots=$("derivative-demo-lots");
  const product=$("derivative-demo-product"),limitPrice=$("derivative-demo-limit-price");
  const buy=$("derivative-demo-buy"),sell=$("derivative-demo-sell");
  const match=$("derivative-demo-match"),refreshDepth=$("derivative-demo-refresh-depth");
  const reset=$("derivative-demo-reset"),status=$("derivative-demo-status");
  const ordersBody=$("derivative-demo-orders"),positionsBody=$("derivative-demo-positions");
  const quoteLabel=$("derivative-demo-quote"),fixtureUrl="../../market-gateway/mock/fixtures/derivatives.json";
  let fixture=null,simulator=null;
  function text(node,value){node.textContent=String(value==null?"—":value);}
  function money(paise){return Number.isSafeInteger(paise)?"₹"+(paise/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
  function addOption(select,value,label){const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);}
  function selectedContract(){
    if(asset.value==="FUTURES")return simulator.contracts().find(item=>item.instrumentKey===futureSelect.value)||null;
    return simulator.contracts().find(item=>item.assetClass==="OPTION"&&item.underlying===underlying.value&&item.expiry===expiry.value&&item.optionType===optionType.value&&item.strikePaise===Number(strike.value))||null;
  }
  function refreshOptionFilters(){
    if(!simulator)return;
    const options=simulator.contracts().filter(item=>item.assetClass==="OPTION"&&item.underlying===underlying.value);
    const expiries=[...new Set(options.map(item=>item.expiry))].sort(),previousExpiry=expiry.value;
    expiry.textContent="";expiries.forEach(item=>addOption(expiry,item,item));if(expiries.includes(previousExpiry))expiry.value=previousExpiry;
    const strikes=[...new Set(options.filter(item=>item.expiry===expiry.value&&item.optionType===optionType.value).map(item=>item.strikePaise))].sort((a,b)=>a-b),previousStrike=strike.value;
    strike.textContent="";strikes.forEach(item=>addOption(strike,String(item),money(item)));if(strikes.includes(Number(previousStrike)))strike.value=previousStrike;
  }
  function updateMode(){
    const isFuture=asset.value==="FUTURES";
    $("derivative-demo-future-fields").hidden=!isFuture;
    $("derivative-demo-option-fields").hidden=isFuture;
    $("derivative-demo-product-field").hidden=!isFuture;
    limitPrice.disabled=orderType.value!=="LIMIT";
    buy.disabled=!simulator||!selectedContract();sell.disabled=!simulator||!selectedContract();
  }
  function fillSelects(){
    const contracts=simulator.contracts();
    futureSelect.textContent="";
    contracts.filter(item=>item.assetClass==="FUTURE").forEach(item=>addOption(futureSelect,item.instrumentKey,item.symbol+" · "+item.expiry+" · lot "+item.lotSize));
    underlying.textContent="";
    [...new Set(contracts.filter(item=>item.assetClass==="OPTION").map(item=>item.underlying))].forEach(item=>addOption(underlying,item,item));
    refreshOptionFilters();updateMode();
  }
  function cell(row,value){const td=document.createElement("td");td.textContent=String(value==null?"—":value);row.append(td);return td;}
  function render(){
    if(!simulator)return;
    const snapshot=simulator.snapshot();ordersBody.textContent="";
    if(!snapshot.orders.length){const row=document.createElement("tr"),td=cell(row,"No demo orders yet.");td.colSpan=10;ordersBody.append(row);}
    snapshot.orders.forEach(order=>{
      const row=document.createElement("tr");
      cell(row,order.orderId);cell(row,order.symbol);cell(row,order.side);cell(row,order.orderType);
      cell(row,order.lots+" ("+order.quantity+")");cell(row,order.limitPricePaise?money(order.limitPricePaise):"—");
      cell(row,order.filledQuantity+" / "+order.remainingQuantity);cell(row,order.averageFillPricePaise?money(order.averageFillPricePaise):"—");
      cell(row,order.fills.map(fill=>fill.quantity+" @ "+money(fill.pricePaise)).join(" · ")||"—");
      const action=cell(row,order.status);
      if(["PENDING","PARTIALLY_FILLED"].includes(order.status)){
        const button=document.createElement("button");button.type="button";button.className="derivative-demo-cancel";button.textContent="CANCEL";
        button.addEventListener("click",()=>{try{simulator.cancel(order.orderId);text(status,"DEMO order "+order.orderId+" cancelled. No ledger or worker was called.");render();}catch(error){text(status,error.message);}});
        action.append(document.createTextNode(" "));action.append(button);
      }
      ordersBody.append(row);
    });
    positionsBody.textContent="";
    if(!snapshot.positions.length){const row=document.createElement("tr"),td=cell(row,"No open demo positions.");td.colSpan=7;positionsBody.append(row);}
    snapshot.positions.forEach(position=>{
      const row=document.createElement("tr");cell(row,position.symbol);
      cell(row,position.assetClass==="OPTION"?position.optionType:"FUT");cell(row,position.expiry);
      cell(row,position.netQuantity);cell(row,money(position.averagePricePaise));
      cell(row,position.reservedCloseQuantity);cell(row,position.availableCloseQuantity==null?"—":position.availableCloseQuantity);
      positionsBody.append(row);
    });
    const contract=selectedContract();
    if(contract){const quote=fixture.data.quotes.find(item=>item.instrumentKey===contract.instrumentKey);
      text(quoteLabel,"DEMO DATA · "+money(quote.bidPricePaise)+" bid / "+money(quote.askPricePaise)+" ask · "+quote.timestamp+" · synthetic");}
    updateMode();
  }
  function parsePrice(value){
    const raw=String(value||"").trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
    const parts=raw.split("."),result=Number(parts[0])*100+Number(((parts[1]||"")+"00").slice(0,2));
    return Number.isSafeInteger(result)&&result>0?result:null;
  }
  function submit(side){
    if(!simulator)return;
    try{
      const contract=selectedContract();if(!contract)throw new Error("Select a synthetic contract first.");
      const request={instrumentKey:contract.instrumentKey,side,orderType:orderType.value,lots:Number(lots.value),product:product.value};
      if(orderType.value==="LIMIT"){request.limitPricePaise=parsePrice(limitPrice.value);if(!request.limitPricePaise)throw new Error("Enter a valid LIMIT price in rupees.");}
      const receipt=simulator.submit(request);
      text(status,receipt.status==="REJECTED"?"DEMO receipt "+receipt.orderId+" rejected: "+receipt.rejectionReason:
        "DEMO receipt "+receipt.orderId+" · "+receipt.status+" · "+receipt.filledQuantity+"/"+receipt.quantity+" units filled.");
      render();
    }catch(error){text(status,error.message||"Demo order could not be submitted.");}
  }
  async function load(){
    try{
      const response=await fetch(fixtureUrl,{cache:"no-store",headers:{Accept:"application/json"}});
      if(!response.ok)throw new Error("DEMO fixture unavailable ("+response.status+").");
      fixture=await response.json();
      simulator=window.ZENURA_DERIVATIVE_MOCK.createDerivativeMockSimulator(fixture);
      fillSelects();text(status,"DEMO DATA loaded. Futures BUY/SELL and long CE/PE BUY/SELL-to-close are simulated locally only.");render();
    }catch(error){text(status,error.message||"Could not load the synthetic derivatives fixture.");buy.disabled=true;sell.disabled=true;}
  }
  asset.addEventListener("change",updateMode);
  [underlying,expiry,optionType].forEach(select=>select.addEventListener("change",()=>{refreshOptionFilters();updateMode();render();}));
  strike.addEventListener("change",()=>{updateMode();render();});
  futureSelect.addEventListener("change",render);
  orderType.addEventListener("change",updateMode);
  buy.addEventListener("click",()=>submit("BUY"));sell.addEventListener("click",()=>submit("SELL"));
  match.addEventListener("click",()=>{
    if(!simulator)return;const result=simulator.processLimitFills();
    text(status,"Manual DEMO matching: "+result.filled+" fully filled, "+result.partial+" partially filled, "+result.notEligible+" not eligible. No background worker ran.");render();
  });
  refreshDepth.addEventListener("click",()=>{
    if(!simulator)return;const result=simulator.refreshQuoteDepth();
    text(status,"DEMO top-of-book depth reset from deterministic fixture ("+result.refreshed+" quotes).");render();
  });
  reset.addEventListener("click",()=>{
    if(!fixture)return;simulator=window.ZENURA_DERIVATIVE_MOCK.createDerivativeMockSimulator(fixture);
    text(status,"DEMO session reset. All local demo orders and positions cleared.");fillSelects();render();
  });
  load();
})();
