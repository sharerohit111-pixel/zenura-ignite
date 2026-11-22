/* ZENURA IGNITE professional chart adapter — KLineChart 10.1.1.
 * Loads only when a symbol is selected. Historical bars use Upstox REST;
 * live ticks are coalesced and aggregated into the active chart interval.
 */
(function(root){
  "use strict";
  const CDN="https://cdn.jsdelivr.net/npm/klinecharts@10.1.1/dist/umd/klinecharts.min.js";
  const PERIODS={
    "1m":{type:"minute",span:1,unit:"minutes",interval:1,days:7},
    "5m":{type:"minute",span:5,unit:"minutes",interval:5,days:14},
    "15m":{type:"minute",span:15,unit:"minutes",interval:15,days:30},
    "1h":{type:"hour",span:1,unit:"hours",interval:1,days:90},
    "1D":{type:"day",span:1,unit:"days",interval:1,days:365}
  };
  const DRAWINGS={
    straightLine:"TRENDLINE",horizontalStraightLine:"HORIZONTAL_LINE",
    horizontalRayLine:"HORIZONTAL_LINE",verticalStraightLine:"VERTICAL_LINE",
    verticalRayLine:"VERTICAL_LINE",rayLine:"RAY",parallelStraightLine:"CHANNEL",
    priceChannelLine:"CHANNEL",fibonacciLine:"FIBONACCI_RETRACEMENT",
    zenuraFibExtension:"FIBONACCI_EXTENSION",zenuraRectangle:"RECTANGLE",
    zenuraCircle:"CIRCLE",zenuraArrow:"ARROW",simpleAnnotation:"TEXT",
    simpleTag:"TEXT",brush:"TEXT",segment:"PRICE_RANGE",priceLine:"HORIZONTAL_LINE"
  };
  let libraryPromise=null,chart=null,container=null,context=null,barCallback=null,lastBar=null;
  let pendingQuote=null,framePending=false,activeTheme=(document.body?.dataset?.chartTheme||"dark"),suppressRemove=false;
  const overlayRows=new Map(),undoStack=[],redoStack=[],activeIndicators=new Set();

  function loadLibrary(){
    if(root.klinecharts)return Promise.resolve(root.klinecharts);
    if(libraryPromise)return libraryPromise;
    libraryPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=CDN;script.async=true;script.crossOrigin="anonymous";
      script.onload=()=>root.klinecharts?resolve(root.klinecharts):reject(new Error("Chart engine loaded without its API."));
      script.onerror=()=>{libraryPromise=null;reject(new Error("Professional chart engine could not be loaded. Check the network and retry."));};
      document.head.appendChild(script);
    });
    return libraryPromise;
  }
  function localDate(offset=0){
    const date=new Date();date.setDate(date.getDate()+offset);
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  }
  function dateFromTimestamp(timestamp,offsetDays=0){
    const shifted=new Date(timestamp+offsetDays*86400000);
    return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(shifted);
  }
  function normalizeBars(candles){
    if(!Array.isArray(candles))return [];
    const byTime=new Map();
    for(const row of candles){
      if(!Array.isArray(row)||row.length<5)continue;
      const timestamp=typeof row[0]==="number"?row[0]:Date.parse(row[0]);
      const open=Number(row[1]),high=Number(row[2]),low=Number(row[3]),close=Number(row[4]);
      const volume=Number(row[5]??0),turnover=Number(row[7]??0);
      if(!Number.isFinite(timestamp)||timestamp<=0||![open,high,low,close].every(Number.isFinite))continue;
      if(open<=0||high<=0||low<=0||close<=0||high<low||high<Math.max(open,close)||low>Math.min(open,close))continue;
      const bar={timestamp,open,high,low,close,volume:Number.isFinite(volume)&&volume>=0?volume:0};
      if(Number.isFinite(turnover)&&turnover>=0&&turnover>0)bar.turnover=turnover;
      byTime.set(timestamp,bar);
    }
    return [...byTime.values()].sort((a,b)=>a.timestamp-b.timestamp);
  }
  function periodBucket(timestamp,period){
    if(period.type==="day"){
      const date=dateFromTimestamp(timestamp,0);
      return Date.parse(date+"T00:00:00+05:30");
    }
    const size=period.span*(period.type==="hour"?3600000:60000);
    return Math.floor(timestamp/size)*size;
  }
  function chartStyles(theme){
    const dark=theme!=="light";
    return {
      grid:{horizontal:{color:dark?"#1d2c40":"#e7edf4"},vertical:{color:dark?"#1d2c40":"#e7edf4"}},
      candle:{type:"candle_solid",bar:{
        upColor:"#22c99a",downColor:"#ff5c76",noChangeColor:dark?"#91a0b5":"#778399",
        upBorderColor:"#22c99a",downBorderColor:"#ff5c76",
        upWickColor:"#22c99a",downWickColor:"#ff5c76"
      }},
      separator:{color:dark?"#26384e":"#dce4ed"},
      crosshair:{horizontal:{line:{color:dark?"#9aabc0":"#64748b"}},vertical:{line:{color:dark?"#9aabc0":"#64748b"}}},
      xAxis:{axisLine:{color:dark?"#52647a":"#9aa9ba"},tickText:{color:dark?"#9fb0c4":"#53657a"}},
      yAxis:{axisLine:{color:dark?"#52647a":"#9aa9ba"},tickText:{color:dark?"#9fb0c4":"#53657a"}},
      overlay:{point:{color:"#4b9fff"},line:{color:"#4b9fff",size:1.5},rect:{color:"#4b9fff"}}
    };
  }
  function registerCustomOverlays(lib){
    const definitions=[
      {name:"zenuraRectangle",totalStep:3,createPointFigures:({coordinates})=>{
        if(coordinates.length<2)return [];
        const a=coordinates[0],b=coordinates[1];
        return [{type:"rect",attrs:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)},styles:{style:"stroke",color:"#4b9fff",borderColor:"#4b9fff",borderSize:1.5}}];
      }},
      {name:"zenuraCircle",totalStep:3,createPointFigures:({coordinates})=>{
        if(coordinates.length<2)return [];
        const a=coordinates[0],b=coordinates[1],r=Math.hypot(b.x-a.x,b.y-a.y);
        return [{type:"circle",attrs:{x:a.x,y:a.y,r},styles:{style:"stroke",color:"#4b9fff",borderColor:"#4b9fff",borderSize:1.5}}];
      }},
      {name:"zenuraArrow",totalStep:3,createPointFigures:({coordinates})=>{
        if(coordinates.length<2)return [];
        const a=coordinates[0],b=coordinates[1],angle=Math.atan2(b.y-a.y,b.x-a.x),size=9;
        const left={x:b.x-size*Math.cos(angle-Math.PI/6),y:b.y-size*Math.sin(angle-Math.PI/6)};
        const right={x:b.x-size*Math.cos(angle+Math.PI/6),y:b.y-size*Math.sin(angle+Math.PI/6)};
        return [
          {type:"line",attrs:{coordinates:[a,b]},styles:{color:"#4b9fff",size:1.8}},
          {type:"polygon",attrs:{coordinates:[b,left,right]},styles:{style:"fill",color:"#4b9fff"}}
        ];
      }},
      {name:"zenuraFibExtension",totalStep:3,createPointFigures:({coordinates,bounding})=>{
        if(coordinates.length<2)return [];
        const a=coordinates[0],b=coordinates[1],range=b.y-a.y;
        const levels=[0,0.618,1,1.272,1.618,2.618];
        const right=Math.max(a.x,b.x,bounding?.right??b.x);
        return levels.map(level=>({type:"line",attrs:{coordinates:[{x:Math.min(a.x,b.x),y:a.y+range*level},{x:right,y:a.y+range*level}]},styles:{color:"#a78bfa",size:1,style:level===0||level===1?"solid":"dashed"}}));
      }}
    ];
    for(const item of definitions){try{lib.registerOverlay(item);}catch(error){if(!String(error?.message||"").toLowerCase().includes("exist"))throw error;}}
  }
  async function getSessionUser(){
    if(!root.ZENURA_MARKET_CONNECTOR?.getUserId?.())return null;
    return root.ZENURA_MARKET_CONNECTOR.getUserId();
  }
  async function persistOverlay(overlay){
    if(suppressRemove||!context||!overlay)return;
    const type=DRAWINGS[overlay.name];if(!type)return;
    const userId=await getSessionUser();if(!userId)return;
    const payload={overlayName:overlay.name,points:overlay.points||[],styles:overlay.styles||{},extendData:overlay.extendData||null};
    const existingId=overlayRows.get(overlay.id);
    const record={user_id:userId,instrument_key:context.instrument.instrument_key,timeframe:context.timeframe,drawing_type:type,payload};
    const {data,error}=existingId
      ? await context.supabase.from("paper_chart_drawings").update(record).eq("drawing_id",existingId).select("drawing_id").maybeSingle()
      : await context.supabase.from("paper_chart_drawings").insert(record).select("drawing_id").single();
    if(error)throw error;
    if(data?.drawing_id)overlayRows.set(overlay.id,data.drawing_id);
  }
  async function removePersistedOverlay(overlay){
    if(suppressRemove||!overlay)return;
    const id=overlayRows.get(overlay.id);overlayRows.delete(overlay.id);
    if(!id||!context?.supabase)return;
    const {error}=await context.supabase.from("paper_chart_drawings").delete().eq("drawing_id",id);
    if(error)console.warn("Could not delete saved chart drawing:",error.message);
  }
  async function loadSavedDrawings(){
    if(!chart||!context)return;
    const userId=await getSessionUser();if(!userId)return;
    const {data,error}=await context.supabase.from("paper_chart_drawings")
      .select("drawing_id,drawing_type,payload")
      .eq("user_id",userId).eq("instrument_key",context.instrument.instrument_key)
      .eq("timeframe",context.timeframe).order("created_at",{ascending:true}).limit(100);
    if(error){console.warn("Saved chart drawings unavailable:",error.message);return;}
    suppressRemove=true;
    try{
      for(const row of data||[]){
        const name=row.payload?.overlayName;
        if(!name||!Array.isArray(row.payload?.points))continue;
        chart.createOverlay({
          name,id:row.drawing_id,points:row.payload.points,styles:row.payload.styles||{},
          extendData:row.payload.extendData||null,
          onDrawEnd:event=>{persistOverlay(event.overlay).catch(()=>{});return true;},
          onPressedMoveEnd:event=>{persistOverlay(event.overlay).catch(()=>{});return true;},
          onRemoved:event=>{removePersistedOverlay(event.overlay).catch(()=>{});return true;}
        });
        overlayRows.set(row.drawing_id,row.drawing_id);
      }
    }finally{suppressRemove=false;}
  }
  async function savePreferences(){
    if(!context?.supabase||!context.instrument)return;
    const userId=await getSessionUser();if(!userId)return;
    const record={
      user_id:userId,instrument_key:context.instrument.instrument_key,
      timeframe:context.timeframe,chart_type:"CANDLE",theme:activeTheme,
      indicators:[...activeIndicators]
    };
    const {error}=await context.supabase.from("paper_chart_preferences").upsert(record,{onConflict:"user_id,instrument_key"});
    if(error)console.warn("Chart preferences could not be saved:",error.message);
  }
  async function loadBars({type,timestamp,callback}){
    const current=context;if(!current)return callback([],false);
    const period=PERIODS[current.timeframe]||PERIODS["1m"];
    const days=period.days;
    const to=type==="forward"&&timestamp?dateFromTimestamp(timestamp,-1):localDate();
    const from=type==="forward"&&timestamp?dateFromTimestamp(timestamp,-days):type==="backward"&&timestamp?dateFromTimestamp(timestamp,0):localDate(-days);
    const token=await current.getAccessToken();
    const params=new URLSearchParams({
      instrument_key:current.instrument.instrument_key,unit:period.unit,
      interval:String(period.interval),to_date:to,from_date:from
    });
    const response=await fetch(current.gateway+"/candles?"+params,{
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      cache:"no-store",signal:AbortSignal.timeout(20000)
    });
    if(!response.ok)throw new Error("Historical candles unavailable ("+response.status+").");
    const payload=await response.json();
    let bars=normalizeBars(payload.data?.candles||[]);
    if(type==="forward"&&timestamp)bars=bars.filter(bar=>bar.timestamp<timestamp);
    if(type==="backward"&&timestamp)bars=bars.filter(bar=>bar.timestamp>timestamp);
    if(type==="init"||!timestamp)lastBar=bars.at(-1)||null;
    else if(type==="backward"&&bars.length)lastBar=bars.at(-1);
    callback(bars,{forward:type==="forward"&&bars.length>=500,backward:type==="backward"&&bars.length>=500});
  }
  function setTheme(theme){
    activeTheme=theme==="light"?"light":"dark";
    if(chart)chart.setStyles(chartStyles(activeTheme));
  }
  async function mount(options){
    const lib=await loadLibrary();
    root.ZenuraChartIndicators?.register(lib);
    if(!container||container!==options.container){
      if(chart){try{lib.dispose(container);}catch(_){}}
      container=options.container;
      container.classList.add("zenura-pro-chart");
      container.textContent="";
      chart=lib.init(container);
      registerCustomOverlays(lib);
      chart.setStyles(chartStyles(activeTheme));
      chart.createIndicator("VOL");
      chart.setDataLoader({
        getBars:async params=>{
          try{await loadBars(params);}catch(error){params.callback([],false);options.onError?.(error);}
        },
        subscribeBar:({callback})=>{barCallback=callback;},
        unsubscribeBar:()=>{barCallback=null;lastBar=null;}
      });
      const observer=new ResizeObserver(()=>{try{chart?.resize();}catch(_){}});
      observer.observe(container);
      container.__zenuraResizeObserver=observer;
    }
    context={...options,supabase:options.supabase||root.ZENURA_SUPABASE};
    const oldOverlays=chart.getOverlays?.()||[];
    suppressRemove=true;
    for(const old of oldOverlays){try{chart.removeOverlay({id:old.id});}catch(_){}}
    suppressRemove=false;
    overlayRows.clear();undoStack.length=0;redoStack.length=0;
    chart.setSymbol({ticker:options.instrument.trading_symbol||options.instrument.instrument_key,pricePrecision:2,volumePrecision:0});
    const period=PERIODS[options.timeframe]||PERIODS["1m"];
    chart.setPeriod({type:period.type,span:period.span});
    await loadSavedDrawings();
    return chart;
  }
  function updateQuote(quote){
    if(!quote||!Number.isFinite(quote.ltp)||quote.ltp<=0||!Number.isFinite(quote.tradeTimeMs)||!barCallback||!context)return;
    pendingQuote=quote;
    if(framePending)return;
    framePending=true;
    requestAnimationFrame(()=>{
      framePending=false;
      const q=pendingQuote;pendingQuote=null;if(!q||!barCallback||!context)return;
      const period=PERIODS[context.timeframe]||PERIODS["1m"];
      const timestamp=periodBucket(q.tradeTimeMs,period),price=q.ltp;
      if(lastBar&&timestamp<lastBar.timestamp)return;
      let next;
      if(lastBar&&timestamp===lastBar.timestamp){
        next={...lastBar,high:Math.max(lastBar.high,price),low:Math.min(lastBar.low,price),close:price};
      }else{
        next={timestamp,open:price,high:price,low:price,close:price,volume:0};
      }
      lastBar=next;barCallback(next);
    });
  }
  function addIndicator(name){
    if(!chart||!name)return false;
    try{chart.createIndicator(name);activeIndicators.add(name);savePreferences().catch(()=>{});return true;}
    catch(error){console.warn("Indicator could not be added:",error);return false;}
  }
  function addDrawing(name){
    if(!chart||!DRAWINGS[name])return false;
    try{
      const id=chart.createOverlay({
        name,
        onDrawEnd:event=>{persistOverlay(event.overlay).catch(error=>console.warn("Drawing save failed:",error.message));undoStack.push({name,points:event.overlay.points||[]});redoStack.length=0;return true;},
        onPressedMoveEnd:event=>{persistOverlay(event.overlay).catch(()=>{});return true;},
        onRemoved:event=>{removePersistedOverlay(event.overlay).catch(()=>{});return true;}
      });
      return !!id;
    }catch(error){console.warn("Drawing tool unavailable:",error);return false;}
  }
  function removeLastDrawing(){
    if(!chart)return false;
    const overlays=chart.getOverlays?.()||[];
    const overlay=overlays.at(-1);if(!overlay)return false;
    chart.removeOverlay({id:overlay.id});return true;
  }
  function undo(){
    if(!chart||!undoStack.length)return false;
    const item=undoStack.pop();redoStack.push(item);
    const overlays=chart.getOverlays?.()||[];
    const overlay=overlays.at(-1);if(overlay)chart.removeOverlay({id:overlay.id});
    return true;
  }
  function redo(){
    const item=redoStack.pop();if(!item)return false;
    return addDrawing(item.name);
  }
  function destroy(){
    if(container?.__zenuraResizeObserver)container.__zenuraResizeObserver.disconnect();
    if(chart&&root.klinecharts){try{root.klinecharts.dispose(container);}catch(_){}}
    chart=null;container=null;context=null;barCallback=null;lastBar=null;
  }
  document.addEventListener("zenura-chart-theme-change",event=>setTheme(event.detail?.theme));
  document.getElementById("chart-add-indicator")?.addEventListener("click",()=>{
    const name=document.getElementById("chart-indicator-select")?.value;
    if(name)addIndicator(name);
  });
  document.querySelectorAll("[data-drawing]").forEach(button=>button.addEventListener("click",()=>{
    document.querySelectorAll("[data-drawing]").forEach(item=>item.classList.toggle("active",item===button));
    addDrawing(button.dataset.drawing);
  }));
  document.getElementById("chart-undo")?.addEventListener("click",undo);
  document.getElementById("chart-redo")?.addEventListener("click",redo);
  document.getElementById("chart-remove-last")?.addEventListener("click",removeLastDrawing);
  root.ZenuraProfessionalChart=Object.freeze({
    mount,updateQuote,setTheme,addIndicator,addDrawing,removeLastDrawing,undo,redo,destroy,
    normalizeBars,periods:Object.freeze({...PERIODS})
  });
})(window);
