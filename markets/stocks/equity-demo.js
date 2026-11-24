(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const money = paise => Number.isSafeInteger(paise) ? "₹" + (paise / 100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—";
  const addCell = (row,value,className) => { const cell=document.createElement("td");cell.textContent=String(value ?? "—");if(className)cell.className=className;row.append(cell); };
  const message = (id,value) => { $(id).textContent=value; };
  let engine=null,fixtures=null,requestNo=0;
  async function boot(){
    try{
      fixtures=await fetch("./equity-dummy-fixtures.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("Demo fixture JSON could not be loaded.");return r.json();});
      engine=window.ZENURA_EQUITY_DUMMY_ENGINE.createEngine({fixtures});
      $("demo-mode-label").textContent=engine.label;
      $("demo-instrument").replaceChildren();
      for(const item of engine.getInstrumentMaster()){const option=document.createElement("option");option.value=item.instrumentKey;option.textContent=item.exchange+" · "+item.tradingSymbol+" · "+item.name;$("demo-instrument").append(option);}
      $("demo-limit-wrap").hidden=true;
      render();syncQuote();
      message("demo-order-message","Demo engine ready. No external services are connected.");
    }catch(error){message("demo-order-message",error.message||"Demo engine failed to load.");}
  }
  function selectedInstrument(){return engine.getInstrumentMaster().find(x=>x.instrumentKey===$("demo-instrument").value);}
  function syncQuote(){const item=selectedInstrument();$("demo-quote").textContent=item?money(item.quotePaise):"—";$("demo-instrument-meta").textContent=item?item.exchange+" · tick "+money(item.tickSizePaise)+" · max fill "+item.maxFillQuantity+" shares":"No instrument";}
  function render(){
    const s=engine.snapshot();
    $("demo-cash").textContent=money(s.cashPaise);
    $("demo-reserved").textContent=money(s.reservedCashPaise);
    $("demo-available").textContent=money(s.availableCashPaise);
    $("demo-position-count").textContent=s.positions.filter(p=>p.quantity>0).length;
    const positions=$("demo-positions");positions.replaceChildren();
    const active=s.positions.filter(p=>p.quantity>0||p.reservedQuantity>0);
    if(!active.length){const tr=document.createElement("tr");addCell(tr,"No positions");tr.firstChild.colSpan=5;positions.append(tr);}
    active.forEach(p=>{const tr=document.createElement("tr");addCell(tr,p.product);addCell(tr,engine.getInstrumentMaster().find(i=>i.instrumentKey===p.instrumentKey)?.tradingSymbol);addCell(tr,p.quantity);addCell(tr,p.reservedQuantity);addCell(tr,money(p.costBasisPaise));positions.append(tr);});
    const orders=$("demo-orders");orders.replaceChildren();
    if(!s.orders.length){const tr=document.createElement("tr");addCell(tr,"No demo orders yet.");tr.firstChild.colSpan=10;orders.append(tr);}
    s.orders.slice().reverse().forEach(o=>{const tr=document.createElement("tr");addCell(tr,o.orderId);addCell(tr,o.tradingSymbol);addCell(tr,o.product);addCell(tr,o.side+" / "+o.orderType);addCell(tr,o.quantity);addCell(tr,o.filledQuantity);addCell(tr,o.remainingQuantity);addCell(tr,money(o.averageExecutionPricePaise));addCell(tr,o.status,"status "+o.status);const action=document.createElement("td");if(["PENDING","PARTIALLY_FILLED"].includes(o.status)){const button=document.createElement("button");button.type="button";button.textContent="Cancel remainder";button.addEventListener("click",()=>{try{engine.cancelOrder(o.orderId);message("demo-order-message","Unfilled remainder cancelled; completed executions were preserved.");render();}catch(e){message("demo-order-message",e.message);}});action.append(button);}else action.textContent=o.cancelReason||o.rejectReason||"—";tr.append(action);orders.append(tr);});
    const receipts=$("demo-receipts");receipts.replaceChildren();
    if(!s.fills.length){const tr=document.createElement("tr");addCell(tr,"No simulated executions yet.");tr.firstChild.colSpan=10;receipts.append(tr);}
    s.fills.slice().reverse().forEach(f=>{const tr=document.createElement("tr");addCell(tr,f.executionId);addCell(tr,f.orderId);addCell(tr,f.tradingSymbol);addCell(tr,f.side);addCell(tr,f.product);addCell(tr,f.quantity);addCell(tr,money(f.executionPricePaise));addCell(tr,money(f.grossPaise));addCell(tr,money(f.chargesPaise));addCell(tr,f.createdAt);receipts.append(tr);});
  }
  $("demo-order-type").addEventListener("change",()=>{$("demo-limit-wrap").hidden=$("demo-order-type").value!=="LIMIT";});
  $("demo-instrument").addEventListener("change",syncQuote);
  $("demo-order-form").addEventListener("submit",event=>{
    event.preventDefault();if(!engine)return;
    const item=selectedInstrument(),type=$("demo-order-type").value,price=Number($("demo-limit-price").value);
    const input={instrumentKey:item.instrumentKey,side:$("demo-side").value,product:$("demo-product").value,orderType:type,quantity:Number($("demo-quantity").value),idempotencyKey:"demo-request-"+String(++requestNo).padStart(8,"0")};
    if(type==="LIMIT")input.limitPricePaise=Math.round(price*100);
    try{const order=engine.submitOrder(input);message("demo-order-message",order.status==="REJECTED"?"Order rejected: "+(order.rejectReason||"validation/account rule"):"Demo order "+order.orderId+" created with status "+order.status+".");render();}
    catch(error){message("demo-order-message",error.message||"Demo order could not be created.");}
  });
  $("demo-process-quote").addEventListener("click",()=>{
    if(!engine)return;const item=selectedInstrument();
    try{const fills=engine.processQuote(item.instrumentKey,item.quotePaise);message("demo-execution-message",fills.length?fills.length+" execution receipt(s) created at "+money(item.quotePaise)+". Press again to process remaining eligible quantity.":"No pending limit order met its price condition.");render();}
    catch(error){message("demo-execution-message",error.message||"Quote processing failed.");}
  });
  $("demo-refresh").addEventListener("click",()=>{if(engine){render();syncQuote();message("demo-execution-message","Snapshot refreshed from local demo engine state.");}});
  boot();
})();
