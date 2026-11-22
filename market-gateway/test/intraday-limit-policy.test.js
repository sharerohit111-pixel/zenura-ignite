"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {marketClockParts,normalizeMarketSession,normalizeExchangeSessionRow,isIntradaySessionOpen,isIntradayOrderExpired,isEligibleIntradayLimitOrder}=require("../lib/intraday-limit-policy");
const normalSession={exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:9*60+15,closeMinute:15*60+30};
const bseSession={...normalSession,exchange:"BSE"};

const epoch=iso=>Date.parse(iso);
const order={order_type:"LIMIT",status:"PENDING",simulation_only:true,product:"INTRADAY",exchange:"NSE",
 user_id:"11111111-1111-4111-8111-111111111111",instrument_key:"NSE_EQ|TEST",
 side:"BUY",quantity:10,limit_price_paise:10000,created_at:"2026-11-23T04:00:00.000Z"};
const quote={pricePaise:9900,tradeTimeMs:epoch("2026-11-23T04:30:00.000Z")};

test("market clock uses Indian Standard Time and handles midnight correctly",()=>{
 assert.deepEqual(marketClockParts(epoch("2026-11-23T03:45:00.000Z")),{weekday:"Mon",year:2026,month:11,day:23,hour:9,minute:15,second:0});
 assert.equal(marketClockParts(epoch("2026-11-23T18:30:00.000Z")).hour,0);
});

test("database exchange calendar rows must be verified, current and match the requested exchange/date",()=>{
 const now=epoch("2026-11-23T04:30:00.000Z");
 const row={exchange:"NSE",session_date:"2026-11-23",is_trading_day:true,
  open_minute:555,close_minute:930,source_reference:"NSE official circular",
  verified_at:"2026-11-23T04:00:00.000Z",source_sha256:"a".repeat(64)};
 assert.deepEqual(normalizeExchangeSessionRow(row,"NSE","2026-11-23",now),normalSession);
 assert.equal(normalizeExchangeSessionRow({...row,exchange:"BSE"},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,session_date:"2026-11-24"},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,is_trading_day:false},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,verified_at:"2026-11-23T04:31:00.000Z"},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,verified_at:"invalid"},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,source_reference:" "},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow({...row,open_minute:null},"NSE","2026-11-23",now),null);
 assert.equal(normalizeExchangeSessionRow(row,"MCX","2026-11-23",now),null);
});
test("intraday session requires an explicit exchange trading-day decision",()=>{
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z")),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:600,closeMinute:900}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),normalSession),true);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:44:59.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T10:00:00.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-22T04:30:00.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:false,openMinute:555,closeMinute:930}),false);
});
test("intraday LIMIT eligibility requires fresh quote, active session and exact side threshold",()=>{
 const now=epoch("2026-11-23T04:30:01.000Z");
 assert.equal(isEligibleIntradayLimitOrder(order,quote,now,normalSession),true);
 assert.equal(isEligibleIntradayLimitOrder({...order,side:"SELL"},quote,now,normalSession),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,side:"SELL",limit_price_paise:9800},quote,now,normalSession),true);
 assert.equal(isEligibleIntradayLimitOrder(order,{...quote,tradeTimeMs:now-15001},now,normalSession),false);
 const justBeforeOpen=epoch("2026-11-23T03:44:59.000Z");
 const justAfterOpen=epoch("2026-11-23T03:45:01.000Z");
 assert.equal(isEligibleIntradayLimitOrder(
  {...order,created_at:"2026-11-23T03:45:00.000Z"},
  {pricePaise:9900,tradeTimeMs:justBeforeOpen},justAfterOpen,normalSession
 ),false,"pre-market quote must not trigger a fill immediately after the open");
 assert.equal(isEligibleIntradayLimitOrder(order,quote,now,{exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:false,openMinute:555,closeMinute:930}),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,product:"DELIVERY"},quote,now,normalSession),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,simulation_only:false},quote,now,normalSession),false);
 const bseOrder={...order,exchange:"BSE",instrument_key:"BSE_EQ|INE002A01018"};
 assert.equal(isEligibleIntradayLimitOrder(bseOrder,quote,now,bseSession),true);
 assert.equal(isEligibleIntradayLimitOrder(bseOrder,quote,now,normalSession),false,"BSE order must not use an NSE session");
});
test("intraday LIMIT worker never executes orders created outside the current trading session",()=>{
 const now=epoch("2026-11-23T04:30:01.000Z");
 assert.equal(isEligibleIntradayLimitOrder({...order,created_at:"2026-11-20T04:00:00.000Z"},quote,now,normalSession),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,created_at:"2026-11-23T03:00:00.000Z"},quote,now,normalSession),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,created_at:"2026-11-23T04:31:00.000Z"},quote,now,normalSession),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,created_at:"bad"},quote,now,normalSession),false);
});
test("intraday pending orders expire at 15:30 IST and never carry to another session",()=>{
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-23T09:59:59.000Z"),normalSession),false);
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-23T10:00:00.000Z"),normalSession),true);
 assert.equal(isIntradayOrderExpired(order,epoch("2026-11-24T04:00:00.000Z"),normalSession),true);
 assert.equal(isIntradayOrderExpired({...order,product:"DELIVERY"},epoch("2026-11-23T10:00:00.000Z"),normalSession),false);
});
test("malformed timestamps and non-pending orders fail closed",()=>{
 assert.throws(()=>marketClockParts(NaN),TypeError);
 assert.equal(normalizeMarketSession({exchange:"NSE",sessionDate:"2026-11-23",isTradingDay:true,openMinute:930,closeMinute:555}),null);
 assert.deepEqual(normalizeMarketSession({exchange:"NSE",sessionDate:"2026-11-22",isTradingDay:true,openMinute:555,closeMinute:930}),{exchange:"NSE",sessionDate:"2026-11-22",isTradingDay:true,openMinute:555,closeMinute:930});
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{...normalSession,sessionDate:"2026-11-24"}),false);
 assert.equal(isIntradaySessionOpen(epoch("2026-11-23T03:45:00.000Z"),{...normalSession,exchange:"MCX"}),false);
 assert.equal(isIntradayOrderExpired({...order,created_at:"bad"},epoch("2026-11-23T10:00:00.000Z")),false);
 assert.equal(isEligibleIntradayLimitOrder({...order,status:"CANCELLED"},quote,epoch("2026-11-23T04:30:01.000Z"),normalSession),false);
});
