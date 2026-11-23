/* ZENURA IGNITE professional chart adapter — KLineChart 10.1.1.
 * Loads only when a symbol is selected. Historical bars use Upstox REST;
 * live ticks are coalesced and aggregated into the active chart interval.
 */
(function(root){
  "use strict";
  const CDN="https://cdn.jsdelivr.net/npm/klinecharts@10.1.1/dist/umd/klinecharts.min.js";
  const BUILTIN_INDICATORS=new Set(["MA","EMA","SMA","BOLL","BBI","BIAS","BRAR","CR","DMA","PSY","AO","MTM","VR","RSI","MACD","KDJ","CCI","OBV","VOL","WR","SAR","TRIX","DMI","ROC","PVT","VWAP","ATR","ADX","STOCH","SUPERTREND","MFI"]);
  const PERIODS={
    "1m":{type:"minute",span:1,unit:"minutes",interval:1,days:7},
    "5m":{type:"minute",span:5,unit:"minutes",interval:5,days:14},
    "15m":{type:"minute",span:15,unit:"minutes",interval:15,days:30},
    "1h":{type:"hour",span:1,unit:"hours",interval:1,days:90},
    "1D":{type:"day",span:1,unit:"days",interval:1,days:1825},
    "1W":{type:"week",span:1,unit:"weeks",interval:1,days:1825},
    "1M":{type:"month",span:1,unit:"months",interval:1,days:1825}
  };
  const DRAWINGS={
    straightLine:"TRENDLINE",horizontalStraightLine:"HORIZONTAL_LINE",
    horizontalRayLine:"HORIZONTAL_LINE",verticalStraightLine:"VERTICAL_LINE",
    verticalRayLine:"VERTICAL_LINE",rayLine:"RAY",parallelStraightLine:"CHANNEL",
    priceChannelLine:"CHANNEL",fibonacciLine:"FIBONACCI_RETRACEMENT",
    zenuraFibExtension:"FIBONACCI_EXTENSION",zenuraRectangle:"RECTANGLE",
    zenuraCircle:"CIRCLE",zenuraArrow:"ARROW",simpleAnnotation:"TEXT",
    simpleTag:"TEXT",brush:"BRUSH",segment:"PRICE_RANGE",priceLine:"HORIZONTAL_LINE"
  };
  let libraryPromise=null,chart=null,container=null,context=null,barCallback=null,lastBar=null;
  let pendingQuote=null,framePending=false,activeTheme=(document.body?.dataset?.chartTheme||"dark"),activeChartType="CANDLE",suppressRemove=false;
  const overlayRows=new Map(),undoStack=[],redoStack=[],activeIndicators=new Set(),candleCache=new Map();

  function loadLibrary(){
    if(root.klinecharts)return Promise.resolve(root.klinecharts);
    if(libraryPromise)return libraryPromise;
    libraryPromise=new Promise((resolve,reject)=>{
      const sources=[CDN,"https://unpkg.com/klinecharts@10.1.1/dist/umd/klinecharts.min.js"];
      let index=0,settled=false;
      const attempt=()=>{
        const script=document.createElement("script");
        let timeout,attemptFinished=false;
        const cleanup=()=>{if(timeout)clearTimeout(timeout);script.onload=null;script.onerror=null;};
        const failAttempt=()=>{
          if(attemptFinished)return;
          attemptFinished=true;cleanup();script.remove();index++;
          if(index<sources.length){attempt();return;}
          if(!settled){settled=true;libraryPromise=null;reject(new Error("Professional chart engine could not be loaded from either CDN. Check the network and retry."));}
        };
        script.src=sources[index];script.async=true;script.crossOrigin="anonymous";script.referrerPolicy="no-referrer";
        script.onload=()=>{
          if(attemptFinished)return;
          attemptFinished=true;cleanup();
          if(root.klinecharts&&!settled){settled=true;resolve(root.klinecharts);}
          else{script.remove();index++;if(index<sources.length)attempt();else if(!settled){settled=true;libraryPromise=null;reject(new Error("Chart engine loaded without its API."));}}
        };
        script.onerror=failAttempt;
        timeout=setTimeout(failAttempt,6000);
        document.head.appendChild(script);
      };
      attempt();
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
  function chartStyles(theme,chartType=activeChartType){
    const dark=theme!=="light";
    return {
      grid:{horizontal:{color:dark?"#1d2c40":"#e7edf4"},vertical:{color:dark?"#1d2c40":"#e7edf4"}},
      candle:{type:chartType==="OHLC"?"ohlc":chartType==="LINE"?"line":chartType==="AREA"?"area":"candle_solid",bar:{
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
  async function loadPreferences(){
    if(!context?.supabase||!context.instrument)return;
    const userId=await getSessionUser();if(!userId)return;
    const {data,error}=await context.supabase.from("paper_chart_preferences")
      .select("chart_type,indicators").eq("user_id",userId)
      .eq("instrument_key",context.instrument.instrument_key).maybeSingle();
    if(error){console.warn("Chart preferences could not be loaded:",error.message);return;}
    // A first-time symbol gets the default volume pane. Saved preferences replace the full set.
    if(!data||!Array.isArray(data.indicators))return;
    const existing=chart?.getIndicators?.()||[];
    for(const item of existing){
      const name=typeof item==="string"?item:item?.name;
      if(name)chart.removeIndicator({name});
    }
    activeIndicators.clear();
    if(["CANDLE","OHLC","AREA","LINE"].includes(data?.chart_type)){
      activeChartType=data.chart_type;
      chart?.setStyles(chartStyles(activeTheme,activeChartType));
      const typeSelect=document.getElementById("chart-type-select");
      if(typeSelect)typeSelect.value=activeChartType;
    }
    const allowed=new Set([...BUILTIN_INDICATORS,...(root.klinecharts?.getSupportedIndicators?.()||[])]);
    if(Array.isArray(data?.indicators)){
      for(const name of data.indicators.slice(0,20)){
        if(typeof name!=="string"||!allowed.has(name))continue;
        try{chart.createIndicator(name);activeIndicators.add(name);}
        catch(error){console.warn("Saved chart indicator could not be restored:",name,error);}
      }
    }
  }
  async function savePreferences(){
    if(!context?.supabase||!context.instrument)return;
    const userId=await getSessionUser();if(!userId)return;
    const record={
      user_id:userId,instrument_key:context.instrument.instrument_key,
      timeframe:context.timeframe,chart_type:activeChartType,theme:activeTheme,
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
    const cacheKey=[current.instrument.instrument_key,current.timeframe,type,timestamp||"latest",from,to].join("|");
    const cached=candleCache.get(cacheKey);
    if(cached&&cached.expiresAt>Date.now()){
      candleCache.delete(cacheKey);candleCache.set(cacheKey,cached);
      const bars=cached.bars.map(bar=>({...bar}));
      if(type==="init"||!timestamp)lastBar=bars.at(-1)||null;
      else if(type==="backward"&&bars.length)lastBar=bars.at(-1);
      callback(bars,{forward:type==="forward"&&bars.length>=500,backward:type==="backward"&&bars.length>=500});
      return;
    }
    if(cached)candleCache.delete(cacheKey);
    const token=await current.getAccessToken();
    if(context!==current)return callback([],{forward:false,backward:false});
    const params=new URLSearchParams({
      instrument_key:current.instrument.instrument_key,unit:period.unit,
      interval:String(period.interval),to_date:to,from_date:from
    });
    const response=await fetch(current.gateway+"/candles?"+params,{
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw new Error("Historical candles unavailable ("+response.status+").");
    const payload=await response.json();
    if(context!==current)return callback([],{forward:false,backward:false});
    let bars=normalizeBars(payload.data?.candles||[]);
    if(type==="forward"&&timestamp)bars=bars.filter(bar=>bar.timestamp<timestamp);
    if(type==="backward"&&timestamp)bars=bars.filter(bar=>bar.timestamp>timestamp);
    const ttl=type==="backward"?300000:15000;
    candleCache.set(cacheKey,{bars:bars.map(bar=>({...bar})),expiresAt:Date.now()+ttl});
    while(candleCache.size>100)candleCache.delete(candleCache.keys().next().value);
    if(type==="init"||!timestamp)lastBar=bars.at(-1)||null;
    else if(type==="backward"&&bars.length)lastBar=bars.at(-1);
    callback(bars,{forward:type==="forward"&&bars.length>=500,backward:type==="backward"&&bars.length>=500});
  }
  function setTheme(theme){
    activeTheme=theme==="light"?"light":"dark";
    if(chart)chart.setStyles(chartStyles(activeTheme,activeChartType));
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
      chart.setStyles(chartStyles(activeTheme,activeChartType));
      chart.createIndicator("VOL");activeIndicators.add("VOL");
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
    await loadPreferences();
    await loadSavedDrawings();
    await loadTemplates();
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
  async function loadTemplates(){
    if(!context?.supabase)return;
    const userId=await getSessionUser();if(!userId)return;
    const {data,error}=await context.supabase.from("paper_chart_templates").select("template_id,name").eq("user_id",userId).order("created_at",{ascending:false}).limit(30);
    if(error){console.warn("Chart templates could not be loaded:",error.message);return;}
    const select=document.getElementById("chart-template-select");if(!select)return;
    select.replaceChildren(new Option("Saved templates",""));
    for(const row of data||[])select.add(new Option(row.name,row.template_id));
  }
  async function saveTemplate(name){
    const clean=String(name||"").trim().slice(0,60);
    if(!clean||!context?.supabase||!context.instrument)return false;
    const userId=await getSessionUser();if(!userId)return false;
    const configuration={chartType:activeChartType,theme:activeTheme,timeframe:context.timeframe,indicators:[...activeIndicators]};
    const {error}=await context.supabase.from("paper_chart_templates").upsert({user_id:userId,name:clean,configuration},{onConflict:"user_id,name"});
    if(error)throw error;
    await loadTemplates();return true;
  }
  async function loadTemplate(templateId){
    if(!context?.supabase||!templateId)return false;
    const userId=await getSessionUser();if(!userId)return false;
    const {data,error}=await context.supabase.from("paper_chart_templates").select("configuration").eq("user_id",userId).eq("template_id",templateId).maybeSingle();
    if(error||!data?.configuration)return false;
    const config=data.configuration;
    if(PERIODS[config.timeframe]){
      context.timeframe=config.timeframe;
      context.onTimeframeChange?.(config.timeframe);
      const period=PERIODS[config.timeframe];chart.setPeriod({type:period.type,span:period.span});
    }
    if(["CANDLE","OHLC","AREA","LINE"].includes(config.chartType))setChartType(config.chartType);
    if(config.theme==="light"||config.theme==="dark")setTheme(config.theme);
    for(const name of [...activeIndicators])chart.removeIndicator({name});
    activeIndicators.clear();
    if(Array.isArray(config.indicators)){
      for(const name of config.indicators.slice(0,20))if(typeof name==="string"&&!activeIndicators.has(name))addIndicator(name);
    }
    await savePreferences();return true;
  }
  function removeIndicator(name){
    if(!chart||!name||!activeIndicators.has(name))return false;
    const removed=chart.removeIndicator({name});
    if(removed){activeIndicators.delete(name);savePreferences().catch(()=>{});}
    return removed;
  }
  function setChartType(type){
    if(!["CANDLE","OHLC","AREA","LINE"].includes(type))return false;
    activeChartType=type;
    if(chart)chart.setStyles(chartStyles(activeTheme,activeChartType));
    savePreferences().catch(()=>{});
    return true;
  }
  function addIndicator(name){
    if(!chart||!name)return false;
    if(activeIndicators.has(name))return true;
    if(activeIndicators.size>=20){console.warn("Chart indicator limit reached; remove an indicator before adding another.");return false;}
    try{chart.createIndicator(name);activeIndicators.add(name);savePreferences().catch(()=>{});return true;}
    catch(error){console.warn("Indicator could not be added:",error);return false;}
  }
  function overlayHandlers(name){
    return {
      onDrawEnd:event=>{
        const overlay=event.overlay;
        if(overlay){
          const snapshot={id:overlay.id,name:overlay.name||name,points:overlay.points||[],styles:overlay.styles||{}};
          undoStack.push(snapshot);redoStack.length=0;
          persistOverlay(overlay).catch(error=>console.warn("Drawing save failed:",error.message));
        }
        return true;
      },
      onPressedMoveEnd:event=>{persistOverlay(event.overlay).catch(()=>{});return true;},
      onRemoved:event=>{removePersistedOverlay(event.overlay).catch(()=>{});return true;}
    };
  }
  function addDrawing(name){
    if(!chart||!DRAWINGS[name])return false;
    try{return !!chart.createOverlay({name,...overlayHandlers(name)});}
    catch(error){console.warn("Drawing tool unavailable:",error);return false;}
  }
  function removeLastDrawing(){
    if(!chart)return false;
    const overlays=chart.getOverlays?.()||[];
    const overlay=overlays.at(-1);if(!overlay)return false;
    undoStack.push({id:overlay.id,name:overlay.name,points:overlay.points||[],styles:overlay.styles||{}});
    chart.removeOverlay({id:overlay.id});return true;
  }
  function undo(){
    if(!chart||!undoStack.length)return false;
    const item=undoStack.pop();redoStack.push(item);
    chart.removeOverlay({id:item.id});return true;
  }
  function redo(){
    if(!chart||!redoStack.length)return false;
    const item=redoStack.pop();
    try{
      const id=chart.createOverlay({name:item.name,points:item.points,styles:item.styles,...overlayHandlers(item.name)});
      if(!id)return false;
      const overlay=(chart.getOverlays?.()||[]).find(x=>x.id===id);
      if(overlay){undoStack.push({id:overlay.id,name:overlay.name||item.name,points:overlay.points||item.points,styles:overlay.styles||item.styles});persistOverlay(overlay).catch(()=>{});}
      return true;
    }catch(error){console.warn("Drawing redo failed:",error);return false;}
  }
  function destroy(){
    if(container?.__zenuraResizeObserver)container.__zenuraResizeObserver.disconnect();
    if(chart&&root.klinecharts){try{root.klinecharts.dispose(container);}catch(_){}}
    chart=null;container=null;context=null;barCallback=null;lastBar=null;
  }
  document.addEventListener("zenura-chart-theme-change",event=>setTheme(event.detail?.theme));
  window.addEventListener("zenura-market-auth-ready",event=>{if(!event.detail?.signedIn)destroy();});
  window.addEventListener("pagehide",destroy,{once:true});
  document.getElementById("chart-type-select")?.addEventListener("change",event=>setChartType(event.target.value));
  document.getElementById("chart-save-template")?.addEventListener("click",()=>{
    const input=document.getElementById("chart-template-name");
    saveTemplate(input?.value).then(saved=>{if(saved&&input)input.value="";}).catch(error=>console.warn("Chart template save failed:",error.message));
  });
  document.getElementById("chart-load-template")?.addEventListener("click",()=>{
    const id=document.getElementById("chart-template-select")?.value;
    if(id)loadTemplate(id).catch(error=>console.warn("Chart template load failed:",error.message));
  });
  document.getElementById("chart-remove-indicator")?.addEventListener("click",()=>removeIndicator(document.getElementById("chart-indicator-select")?.value));
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
    mount,updateQuote,setTheme,setChartType,addIndicator,removeIndicator,addDrawing,removeLastDrawing,undo,redo,saveTemplate,loadTemplate,destroy,
    normalizeBars,periods:Object.freeze({...PERIODS})
  });
})(window);
