import { createChartDemoModel, createDemoCandles, createDemoDepth } from "./demo-chart-data.mjs";

export function mountDemoChart(root) {
  if (!root) return;
  root.classList.add("demo-market-panel");
  root.innerHTML = "<div class=\"demo-head\"><div><span class=\"demo-kicker\">CHARTS &amp; MARKET DATA PLAYGROUND</span><h2>Simulated Market Explorer</h2></div><span class=\"demo-badge\">MOCK · DEMO DATA · NOT LIVE NSE/BSE</span></div>\n<p class=\"demo-disclaimer\">MOCK identity · DUMMY_JSON shared fixtures · deterministic synthetic OHLCV and fixture-provided depth only when available. These are not live NSE/BSE prices, exchange quotes or executable liquidity. This chart demo is read-only and never submits orders.</p>\n<div id=\"demo-loading\" class=\"demo-loading\" role=\"status\">Loading fixed synthetic fixture…</div>\n<div id=\"demo-content\" hidden>\n <div class=\"demo-controls\"><label class=\"demo-kicker\" for=\"demo-instrument\">DEMO INSTRUMENT</label><select id=\"demo-instrument\" aria-label=\"Select demo instrument\"></select>\n <span class=\"demo-kicker\">TIMEFRAME</span><button type=\"button\" data-demo-timeframe=\"1m\">1m</button><button type=\"button\" data-demo-timeframe=\"5m\" class=\"active\">5m</button><button type=\"button\" data-demo-timeframe=\"15m\">15m</button><button type=\"button\" data-demo-timeframe=\"1h\">1h</button><button type=\"button\" data-demo-timeframe=\"1D\">1D</button><button type=\"button\" data-demo-timeframe=\"1W\">1W</button><button type=\"button\" data-demo-timeframe=\"1M\">1M</button>\n <span class=\"demo-kicker\">STYLE</span><button type=\"button\" data-demo-chart-type=\"CANDLE\" class=\"active\">CANDLESTICK</button><button type=\"button\" data-demo-chart-type=\"LINE\">LINE</button></div>\n <div class=\"demo-layout\"><div class=\"demo-chart-card\"><div class=\"demo-chart-meta\"><div><small id=\"demo-symbol\"></small><strong id=\"demo-last\">—</strong><small id=\"demo-change\">—</small></div><span class=\"demo-ohlc\" id=\"demo-ohlc\"></span></div>\n <svg id=\"demo-chart-svg\" class=\"demo-chart-svg\" viewBox=\"0 0 900 365\" role=\"img\" aria-label=\"Synthetic candlestick or line chart with volume\"></svg>\n <div class=\"demo-quote-meta\"><span id=\"demo-bar-time\"></span><span id=\"demo-snapshot-time\"></span><span>Volume bars · synthetic units</span></div></div>\n <div class=\"demo-depth-card\"><h3>Fixture Bid / Ask Depth</h3><p id=\"demo-depth-status\" class=\"demo-disclaimer\" role=\"status\"></p><div><div class=\"demo-depth-label\"><span>BIDS</span><span>QTY</span></div><div id=\"demo-bids\"></div></div><div><div class=\"demo-depth-label\"><span>ASKS</span><span>QTY</span></div><div id=\"demo-asks\"></div></div><div class=\"demo-quote-meta\"><span>Canonical fixture levels only</span><span>Not executable liquidity</span></div></div></div>\n</div>";
  const $ = id => root.querySelector("#" + id);
  const money = value => "₹" + Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const time = value => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  let model, instrument, timeframe = "5m", kind = "CANDLE";

  function render() {
    const bars = createDemoCandles(instrument, timeframe, 64, model.asOf);
    const last = bars.at(-1), first = bars[0];
    const min = Math.min(...bars.map(bar => bar.low)), max = Math.max(...bars.map(bar => bar.high));
    const range = Math.max(0.01, max - min), left = 54, right = 850, top = 22, bottom = 250, volTop = 278, volBottom = 338;
    const x = i => left + i * (right - left) / (bars.length - 1);
    const y = price => top + (max - price) / range * (bottom - top);
    const maxVol = Math.max(...bars.map(bar => bar.volume));
    const grid = [0,1,2,3].map(i => {
      const yy = top + i * (bottom - top) / 3, price = max - i * range / 3;
      return '<line x1="'+left+'" x2="'+right+'" y1="'+yy+'" y2="'+yy+'" class="demo-grid"/><text x="8" y="'+(yy+4)+'" class="demo-axis">'+money(price)+'</text>';
    }).join("");
    const candles = bars.map((bar,i) => {
      const xx=x(i), up=bar.close>=bar.open, color=up?"#20c997":"#ff657d";
      const yy=y(Math.max(bar.open,bar.close)), hh=Math.max(1,Math.abs(y(bar.open)-y(bar.close)));
      return '<line x1="'+xx+'" x2="'+xx+'" y1="'+y(bar.high)+'" y2="'+y(bar.low)+'" stroke="'+color+'" stroke-width="1.4"/><rect x="'+(xx-2.7)+'" y="'+yy+'" width="5.4" height="'+hh+'" rx="1" fill="'+color+'"/>';
    }).join("");
    const line = bars.map((bar,i) => (i ? "L" : "M") + x(i).toFixed(2) + " " + y(bar.close).toFixed(2)).join(" ");
    const volumes = bars.map((bar,i) => {
      const height=bar.volume/maxVol*(volBottom-volTop);
      return '<rect x="'+(x(i)-2.5)+'" y="'+(volBottom-height)+'" width="5" height="'+height+'" fill="'+(bar.close>=bar.open?"#20c997":"#ff657d")+'" opacity=".72"/>';
    }).join("");
    const chart = kind === "LINE"
      ? '<path d="'+line+'" class="demo-line"/><path d="'+line+' L'+right+' '+bottom+' L'+left+' '+bottom+' Z" class="demo-area"/>'
      : candles;
    $("demo-chart-svg").innerHTML = grid + chart + '<line x1="'+left+'" x2="'+right+'" y1="'+(volTop-8)+'" y2="'+(volTop-8)+'" class="demo-grid"/>' + volumes +
      '<text x="'+left+'" y="356" class="demo-axis">'+esc(time(first.timestamp))+'</text><text x="'+right+'" y="356" text-anchor="end" class="demo-axis">'+esc(time(last.timestamp))+'</text>';
    $("demo-symbol").textContent = instrument.symbol + " · " + instrument.name;
    $("demo-last").textContent = money(last.close);
    $("demo-change").textContent = ((last.close-first.open)/first.open*100).toFixed(2) + "% simulated range";
    $("demo-ohlc").textContent = "O "+money(last.open)+"  H "+money(last.high)+"  L "+money(last.low)+"  C "+money(last.close);
    $("demo-bar-time").textContent = "Bar time (IST): " + time(last.timestamp);
    $("demo-snapshot-time").textContent = "MOCK fixture snapshot: " + model.asOf + " · fixed sample timestamp";
    const depth = createDemoDepth(instrument, model);
    $("demo-depth-status").textContent = depth
      ? "Canonical MOCK fixture depth · " + depth.bids.length + " bid / " + depth.asks.length + " ask levels"
      : "Depth unavailable for this instrument in the canonical MOCK fixture.";
    $("demo-bids").innerHTML = depth ? depth.bids.map(level => '<div class="demo-depth-row bid"><span>'+money(level.price)+'</span><span>'+level.quantity.toLocaleString("en-IN")+'</span><i style="--depth:'+Math.min(100,Math.round(level.quantity/Math.max(1,depth.bids[0].quantity)*100))+'%"></i></div>').join("") : "";
    $("demo-asks").innerHTML = depth ? depth.asks.map(level => '<div class="demo-depth-row ask"><span>'+money(level.price)+'</span><span>'+level.quantity.toLocaleString("en-IN")+'</span><i style="--depth:'+Math.min(100,Math.round(level.quantity/Math.max(1,depth.asks[0].quantity)*100))+'%"></i></div>').join("") : "";
  }

  function setActive(selector, value, attribute) {
    root.querySelectorAll(selector).forEach(el => {const active=el.getAttribute(attribute)===value;el.classList.toggle("active",active);el.setAttribute("aria-pressed",String(active));});
  }
  root.addEventListener("click", event => {
    const tf = event.target.closest("[data-demo-timeframe]"), type = event.target.closest("[data-demo-chart-type]");
    if (tf) { timeframe=tf.dataset.demoTimeframe; setActive("[data-demo-timeframe]",timeframe,"data-demo-timeframe"); render(); }
    if (type) { kind=type.dataset.demoChartType; setActive("[data-demo-chart-type]",kind,"data-demo-chart-type"); render(); }
  });
  $("demo-instrument").addEventListener("change", event => {
    instrument = model.instruments.find(item => item.instrumentKey === event.target.value) || model.instruments[0];
    render();
  });

  async function load() {
    try {
      const paths = ["market","account","equity","derivatives"];
      const responses = await Promise.all(paths.map(name => fetch("../../market-gateway/mock/fixtures/"+name+".json", { method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })));
      if (responses.some(response => !response.ok)) throw new Error("MOCK_FIXTURE_UNAVAILABLE");
      const values = await Promise.all(responses.map(response => response.json()));
      const fixtures = Object.fromEntries(paths.map((name,index) => [name, values[index]]));
      model = createChartDemoModel(fixtures, { enabled: true, production: false });
      instrument = model.instruments[0];
      $("demo-instrument").innerHTML = model.instruments.map(item => '<option value="'+esc(item.instrumentKey)+'">'+esc(item.symbol)+' · '+esc(item.assetClass)+'</option>').join("");
      $("demo-instrument").value = instrument.instrumentKey;
      render();
      $("demo-loading").hidden = true;
      $("demo-content").hidden = false;
    } catch (error) {
      $("demo-loading").textContent = "Shared MOCK fixtures unavailable or invalid. No synthetic chart data is displayed.";
      $("demo-loading").setAttribute("data-error", error?.message || "MOCK_FIXTURE_UNAVAILABLE");
    }
  }
  load();
}
