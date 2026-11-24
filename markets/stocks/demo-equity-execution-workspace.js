(function(){
  "use strict";
  const root=document.getElementById("demo-execution-lab");if(!root)return;
  const $=id=>document.getElementById(id);
  const money=paise=>"₹"+(Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  const time=value=>new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value));
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let engine=null,instrumentKey="",orderCounter=0,selectedOrderId="";
  function status(message){$("demo-exec-status").textContent=message;}
  function activeOrder(){
    const order=engine?.getOrder(selectedOrderId);
    return order&&["PENDING","PARTIALLY_FILLED"].includes(order.status)?order:null;
  }
  function render(){
    if(!engine)return;
    const state=engine.snapshot(),account=state.account,orders=state.orders,fills=state.fills;
    $("demo-exec-cash").textContent=money(account.cashBalancePaise);
    $("demo-exec-blocked").textContent=money(account.blockedFundsPaise);
    $("demo-exec-available").textContent=money(account.availableFundsPaise);
    $("demo-exec-pnl").textContent=money(account.realizedPnlPaise);
    $("demo-exec-mark").textContent=money(state.valuation.markPricePaise);
    $("demo-exec-unrealized").textContent=money(state.valuation.unrealizedPnlPaise);
    $("demo-exec-total-pnl").textContent=money(state.valuation.totalPnlPaise);
    const delivery=account.positions[instrumentKey],intraday=account.intradayPositions[instrumentKey];
    const describe=p=>p?p.quantity+" shares · reserved "+(p.reservedQuantity||0)+" · avg "+money(p.averagePricePaise):"0 shares · reserved 0";
    $("demo-exec-positions").textContent="Delivery: "+describe(delivery)+" · Intraday: "+describe(intraday);
    const selector=$("demo-exec-order-select"),previous=selector.value||selectedOrderId;
    selector.innerHTML=orders.length?orders.map(o=>'<option value="'+escape(o.orderId)+'">'+escape(o.side+" "+o.quantity+" "+o.symbol+" · "+o.status+" · "+o.orderId)+'</option>').join(""):'<option value="">No orders yet</option>';
    selectedOrderId=orders.some(o=>o.orderId===previous)?previous:(orders.at(-1)?.orderId||"");
    selector.value=selectedOrderId;
    const active=activeOrder();
    $("demo-exec-next-fill").disabled=!active;
    $("demo-exec-cancel").disabled=!active;
    $("demo-exec-orders").innerHTML=orders.length?orders.map(o=>'<tr><td>'+escape(o.orderId)+'</td><td>'+escape(o.side)+'</td><td>'+escape(o.product)+'</td><td>'+o.quantity+'</td><td>'+o.filledQuantity+'</td><td>'+money(o.averagePricePaise)+'</td><td>'+escape(o.status)+'</td></tr>').join(""):'<tr><td colspan="7">No demo orders.</td></tr>';
    $("demo-exec-fills").innerHTML=fills.length?fills.map(f=>'<tr><td>'+escape(f.fillId)+'</td><td>'+f.quantity+'</td><td>'+money(f.pricePaise)+'</td><td>'+escape(time(f.filledAt))+'</td><td>'+money(f.realizedPnlPaise)+'</td></tr>').join(""):'<tr><td colspan="5">No executions yet.</td></tr>';
  }
  function setLimitVisibility(){
    const limit=$("demo-exec-type").value==="LIMIT";
    $("demo-exec-limit-wrap").hidden=!limit;
    $("demo-exec-limit").disabled=!limit;
    $("demo-exec-limit").required=limit;
  }
  $("demo-exec-type").addEventListener("change",setLimitVisibility);
  $("demo-exec-form").addEventListener("submit",event=>{
    event.preventDefault();if(!engine)return;
    try{
      const orderType=$("demo-exec-type").value,raw=$("demo-exec-limit").value;
      const input={idempotencyKey:"demo-ui-order-"+String(++orderCounter).padStart(6,"0"),
        instrumentKey,side:$("demo-exec-side").value,orderType,product:$("demo-exec-product").value,
        quantity:Number($("demo-exec-quantity").value)};
      if(orderType==="LIMIT")input.limitPricePaise=Math.round(Number(raw)*100);
      const order=engine.submitOrder(input);selectedOrderId=order.orderId;
      status("Demo order accepted: "+order.orderId+". No fill occurs until you execute the next synthetic book level.");
      $("demo-exec-fill-status").textContent="Order is "+order.status+". Use Execute Next Book Level to simulate a fill.";
      render();
    }catch(error){status("Order rejected: "+(error.code||error.message||"INVALID_DEMO_ORDER"));}
  });
  $("demo-exec-order-select").addEventListener("change",event=>{selectedOrderId=event.target.value;render();});
  $("demo-exec-next-fill").addEventListener("click",()=>{
    const order=activeOrder();if(!order)return;
    try{
      const result=engine.matchNext(order.orderId);
      if(result.matched){
        const f=result.fill;
        $("demo-exec-fill-status").textContent="Filled "+f.quantity+" @ "+money(f.pricePaise)+" · "+f.fillId+" · "+(result.order.remainingQuantity?result.order.remainingQuantity+" remaining":"Order fully filled");
      }else $("demo-exec-fill-status").textContent="No fill: "+result.reason+". You can cancel the remaining quantity if needed.";
      render();
    }catch(error){$("demo-exec-fill-status").textContent="Execution rejected: "+(error.code||error.message||"DEMO_EXECUTION_ERROR");}
  });
  $("demo-exec-cancel").addEventListener("click",()=>{
    const order=activeOrder();if(!order)return;
    try{
      const result=engine.cancelOrder(order.orderId);
      $("demo-exec-fill-status").textContent="Cancelled unfilled remainder. Released "+money(result.releasedCashPaise)+" and "+result.releasedShareQuantity+" shares. Completed fills remain recorded.";
      render();
    }catch(error){$("demo-exec-fill-status").textContent="Cancel rejected: "+(error.code||error.message||"DEMO_CANCEL_ERROR");}
  });
  async function init(){
    try{
      if(!window.ZenuraEquityDemoEngine)throw new Error("DEMO_ENGINE_UNAVAILABLE");
      const [fixtureResponse,accountResponse]=await Promise.all([
        fetch("../../market-gateway/mock/fixtures/equity-execution.json",{cache:"no-store"}),
        fetch("../../market-gateway/mock/fixtures/account.json",{cache:"no-store"})
      ]);
      if(!fixtureResponse.ok||!accountResponse.ok)throw new Error("DEMO_FIXTURE_UNAVAILABLE");
      const [fixtureEnvelope,accountEnvelope]=await Promise.all([fixtureResponse.json(),accountResponse.json()]);
      if(accountEnvelope.mode!=="MOCK"||accountEnvelope.simulated!==true||accountEnvelope.meta?.source!=="SYNTHETIC_FIXTURE"||
        !accountEnvelope.data?.accountId?.startsWith("mock-")||accountEnvelope.data?.currency!=="INR")throw new Error("INVALID_DEMO_ACCOUNT_FIXTURE");
      const fixture=window.ZenuraEquityDemoEngine.validateEquityDemoFixture(fixtureEnvelope);
      engine=window.ZenuraEquityDemoEngine.createEquityDemoExecutionEngine({
        fixture,account:accountEnvelope.data,env:{NODE_ENV:"development"}
      });
      instrumentKey=fixture.data.instrument.instrumentKey;
      $("demo-exec-instrument").textContent=fixture.data.instrument.symbol+" · "+fixture.data.instrument.name+" · FIXTURE "+fixture.asOf;
      $("demo-execution-loading").hidden=true;$("demo-execution-content").hidden=false;
      setLimitVisibility();render();
    }catch(error){$("demo-execution-loading").textContent="Demo execution unavailable. No order or price was generated. ("+(error.code||error.message||"FIXTURE_ERROR")+")";}
  }
  init();
})();