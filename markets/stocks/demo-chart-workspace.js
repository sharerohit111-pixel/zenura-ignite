(function(){
  "use strict";
  const root=document.getElementById("demo-market-lab");if(!root)return;
  const $=id=>root.querySelector("#"+id);
  const money=value=>"₹"+Number(value).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  const time=value=>new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let fixture,instrument,timeframe="5m",kind="CANDLE";
  function render(){
    const bars=window.ZenuraDemoCharts.createDemoCandles(instrument,timeframe,64),last=bars.at(-1),first=bars[0];
    const min=Math.min(...bars.map(x=>x.low)),max=Math.max(...bars.map(x=>x.high)),range=Math.max(.01,max-min),left=54,right=850,top=22,bottom=250,volTop=278,volBottom=338;
    const x=i=>left+i*(right-left)/(bars.length-1),y=p=>top+(max-p)/range*(bottom-top),maxVol=Math.max(...bars.map(x=>x.volume));
    const grid=[0,1,2,3].map(i=>{const yy=top+i*(bottom-top)/3,price=max-i*range/3;return '<line x1="'+left+'" x2="'+right+'" y1="'+yy+'" y2="'+yy+'" class="demo-grid"/><text x="8" y="'+(yy+4)+'" class="demo-axis">'+money(price)+'</text>';}).join("");
    const candle=bars.map((b,i)=>{const xx=x(i),up=b.close>=b.open,color=up?"#20c997":"#ff657d",yy=y(Math.max(b.open,b.close)),hh=Math.max(1,Math.abs(y(b.open)-y(b.close))),vw=5.4;return '<line x1="'+xx+'" x2="'+xx+'" y1="'+y(b.high)+'" y2="'+y(b.low)+'" stroke="'+color+'" stroke-width="1.4"/><rect x="'+(xx-vw/2)+'" y="'+yy+'" width="'+vw+'" height="'+hh+'" rx="1" fill="'+color+'"/>';}).join("");
    const line=bars.map((b,i)=>(i?"L":"M")+x(i).toFixed(2)+" "+y(b.close).toFixed(2)).join(" ");
    const volumes=bars.map((b,i)=>{const xx=x(i),h=b.volume/maxVol*(volBottom-volTop);return '<rect x="'+(xx-2.5)+'" y="'+(volBottom-h)+'" width="5" height="'+h+'" fill="'+(b.close>=b.open?"#20c997":"#ff657d")+'" opacity=".72"/>';}).join("");
    const chart=kind==="LINE"?'<path d="'+line+'" class="demo-line"/><path d="'+line+' L'+right+' '+bottom+' L'+left+' '+bottom+' Z" class="demo-area"/>':candle;
    $("demo-chart-svg").innerHTML=grid+chart+'<line x1="'+left+'" x2="'+right+'" y1="'+(volTop-8)+'" y2="'+(volTop-8)+'" class="demo-grid"/>'+volumes+'<text x="'+left+'" y="356" class="demo-axis">'+esc(time(first.timestamp))+'</text><text x="'+right+'" y="356" text-anchor="end" class="demo-axis">'+esc(time(last.timestamp))+'</text>';
    $("demo-symbol").textContent=instrument.symbol+" · "+instrument.name;
    $("demo-last").textContent=money(last.close);
    $("demo-change").textContent=((last.close-first.open)/first.open*100).toFixed(2)+"% simulated range";
    $("demo-ohlc").textContent="O "+money(last.open)+"  H "+money(last.high)+"  L "+money(last.low)+"  C "+money(last.close);
    $("demo-bar-time").textContent="Bar time (IST): "+time(last.timestamp);
    $("demo-snapshot-time").textContent="Fixture snapshot: "+fixture.asOf+" · fixed sample timestamp";
    const depth=window.ZenuraDemoCharts.createDemoDepth(instrument,fixture);
    $("demo-bids").innerHTML=depth.bids.map((v,i)=>'<div class="demo-depth-row bid"><span>'+money(v.price)+'</span><span>'+v.quantity.toLocaleString("en-IN")+'</span><i style="--depth:'+Math.round(v.quantity/1250*100)+'%"></i></div>').join("");
    $("demo-asks").innerHTML=depth.asks.map((v,i)=>'<div class="demo-depth-row ask"><span>'+money(v.price)+'</span><span>'+v.quantity.toLocaleString("en-IN")+'</span><i style="--depth:'+Math.round(v.quantity/1180*100)+'%"></i></div>').join("");
  }
  function setActive(selector,value,attribute){root.querySelectorAll(selector).forEach(el=>el.classList.toggle("active",el.getAttribute(attribute)===value));}
  root.addEventListener("click",event=>{
    const tf=event.target.closest("[data-demo-timeframe]"),type=event.target.closest("[data-demo-chart-type]");
    if(tf){timeframe=tf.dataset.demoTimeframe;setActive("[data-demo-timeframe]",timeframe,"data-demo-timeframe");render();}
    if(type){kind=type.dataset.demoChartType;setActive("[data-demo-chart-type]",kind,"data-demo-chart-type");render();}
  });
  $("demo-instrument").addEventListener("change",event=>{instrument=fixture.data.instruments.find(x=>x.instrumentKey===event.target.value)||fixture.data.instruments[0];render();});
  fetch("./demo-market-data.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error("DEMO_FIXTURE_UNAVAILABLE");return r.json();}).then(data=>{
    fixture=window.ZenuraDemoCharts.validateFixture(data);instrument=fixture.data.instruments[0];
    $("demo-instrument").innerHTML=fixture.data.instruments.map(x=>'<option value="'+esc(x.instrumentKey)+'">'+esc(x.symbol)+'</option>').join("");
    $("demo-instrument").value=instrument.instrumentKey;render();$("demo-loading").hidden=true;$("demo-content").hidden=false;
  }).catch(()=>{$("demo-loading").textContent="Demo fixture unavailable. No market price is being displayed.";});
})();