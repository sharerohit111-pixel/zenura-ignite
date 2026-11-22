"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {transformAccount,transformEquityOrder,transformDerivativeOrder,transformWatchlist,transformRecord,user,validateUserMap,transformExport}=require("../scripts/firebase-to-supabase-transform");
const map={"legacy-user":"123e4567-e89b-42d3-a456-426614174000"};
const acct={
 currency:"INR",createdAt:"2026-11-20T09:00:00Z",updatedAt:"2026-11-20T10:00:00Z",startingCashPaise:100000000,cashPaise:85000000,reservedCashPaise:5000000,
 reservedMarginPaise:0,realizedPnlPaise:200000,deliveryRealizedPnlPaise:150000,
 intradayRealizedPnlPaise:50000,version:9,
 positions:{"NSE_EQ|ABC":{quantity:10,averagePricePaise:1000,costBasisPaise:10000,updatedAt:"2026-11-20T10:00:00Z"}},
 intradayPositions:{"NSE_EQ|XYZ":{quantity:5,averagePricePaise:2000,updatedAt:"2026-11-20T10:00:00Z"}},
 derivativePositions:{"NSE_FO|ABC26NOVCE":{instrumentType:"CE",netQuantity:25,averagePricePaise:500,costBasisPaise:12500,exchange:"NSE",segment:"NSE_FO",expiry:"2026-11-26",lotSize:25,updatedAt:"2026-11-20T10:00:00Z"}},
 reservedPositions:{"NSE_EQ|ABC":2},intradayReservedPositions:{}
};
test("preserves shared INR account, product-separated positions and reservations",()=>{
 const r=transformAccount({documentId:"legacy-user",data:acct},map);
 assert.equal(r.account.cash_paise,85000000);
 assert.equal(r.account.starting_cash_paise,100000000);
 assert.equal(r.positions.length,2);
 assert.equal(r.positions[0].reserved_quantity,2);
 assert.equal(r.positions[1].product,"INTRADAY");
 assert.equal(r.derivatives[0].instrument_type,"CE");
});
test("requires pre-provisioned UUID; never invents mapping",()=>{
 assert.throws(()=>user("unknown",{}),/Missing pre-provisioned/);
});
test("rejects oversubscribed cash and inconsistent cost basis",()=>{
 const over={...acct,cashPaise:100,reservedCashPaise:101};
 assert.throws(()=>transformAccount({documentId:"legacy-user",data:over},map),/Reservations exceed/);
 const bad={...acct,positions:{"NSE_EQ|ABC":{quantity:10,averagePricePaise:1000,costBasisPaise:9000}}};
 assert.throws(()=>transformAccount({documentId:"legacy-user",data:bad},map),/disagree/);
});
test("preserves legacy SHA256 order id and nullable idempotency key",()=>{
 const r=transformEquityOrder({documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:2,orderType:"MARKET",status:"FILLED",executionPricePaise:1000,grossPaise:2000,createdAt:"2026-11-20T10:00:00Z",updatedAt:"2026-11-20T10:00:00Z"}},map);
 assert.equal(r.order_id,"a".repeat(64));
 assert.equal(r.idempotency_key,null);
 assert.equal(r.product,"DELIVERY");
});
test("rejects unsupported Intraday LIMIT order",()=>{
 const record={documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:1,product:"INTRADAY",orderType:"LIMIT",status:"PENDING"}};
 assert.throws(()=>transformEquityOrder(record,map),/Intraday LIMIT/);
});
test("maps derivative charge and cash metadata",()=>{
 const record={documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_FO|ABC",side:"BUY",quantity:25,instrumentType:"CE",lots:1,lotSize:25,status:"FILLED",executionPricePaise:500,quoteTimestampMs:1000,quoteAgeMs:100,grossPaise:12500,chargesPaise:500,totalDebitPaise:13000,realizedPnlPaise:0,cashDeltaPaise:-13000,chargesBreakdown:{brokerage:200},createdAt:"2026-11-20T10:00:00Z"}};
 const r=transformDerivativeOrder(record,map);
 assert.equal(r.instrument_type,"CE");
 assert.equal(r.strike_price,null,"legacy orders without strike metadata remain importable as NULL");
 assert.equal(r.cash_delta_paise,-13000);
 assert.equal(r.charges_breakdown.brokerage,200);
});
test("preserves finite positive option strike price and rejects unsafe values",()=>{
 const base={documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_FO|ABC",side:"BUY",quantity:25,instrumentType:"CE",lots:1,lotSize:25,status:"FILLED",executionPricePaise:500,quoteTimestampMs:1000,quoteAgeMs:100,grossPaise:12500,chargesPaise:500,totalDebitPaise:13000,realizedPnlPaise:0,cashDeltaPaise:-13000,chargesBreakdown:{},createdAt:"2026-11-20T10:00:00Z"}};
 assert.equal(transformDerivativeOrder({...base,data:{...base.data,strikePrice:25000}},map).strike_price,25000);
 for(const strikePrice of [0,-1,NaN,Infinity,-Infinity,"25000"]){
  assert.throws(()=>transformDerivativeOrder({...base,data:{...base.data,strikePrice}},map),/finite positive number/);
 }
});
test("migrates four named watchlists and legacy instrumentKeys",()=>{
 const record={documentId:"legacy-user",data:{instrumentKeys:["A","A"],watchlists:{Banking:["B"],NIFTY:["C"],"F&O":["D"]},updatedAt:"2026-11-20T10:00:00Z"}};
 const rows=transformWatchlist(record,map);
 assert.equal(rows.length,4);
 assert.deepEqual(rows[0].instrument_keys,["A"]);
 assert.deepEqual(rows[1].instrument_keys,["B"]);
 const invalid={documentId:"legacy-user",data:{watchlists:{NIFTY:Array.from({length:51},(_,i)=>"K"+i)},updatedAt:"2026-11-20T10:00:00Z"}};
 assert.throws(()=>transformWatchlist(invalid,map),/50 keys/);
});
test("dispatches account records",()=>{
 const r=transformRecord({collection:"indianPaperAccounts",documentId:"legacy-user",data:acct},map);
 assert.equal(r.table,"paper_accounts");
 assert.equal(r.positions.length,2);
});

test("rejects duplicate Supabase UUIDs mapped to different Firebase UIDs",()=>{
 assert.throws(()=>validateUserMap({"legacy-one":map["legacy-user"],"legacy-two":map["legacy-user"]}),/multiple Firebase UIDs/);
});

test("emits the private identity map, four watchlists and dependency-safe import order",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"zenura-transform-"));
 const input=path.join(root,"input"),output=path.join(root,"output");
 await fs.mkdir(input);
 const auth=JSON.stringify({uid:"legacy-user",emailVerified:true})+"\n";
 const account=JSON.stringify({collection:"indianPaperAccounts",documentId:"legacy-user",data:acct})+"\n";
 const watchlist=JSON.stringify({collection:"indianMarketWatchlists",documentId:"legacy-user",data:{watchlists:{"My Stocks":["A"],Banking:["B"],NIFTY:["C"],"F&O":["D"]},updatedAt:"2026-11-20T10:00:00Z"}})+"\n";
 const contents={"firebase-auth-users.jsonl":auth,"indianPaperAccounts.jsonl":account,"indianPaperOrders.jsonl":"","indianDerivativeOrders.jsonl":"","indianMarketWatchlists.jsonl":watchlist};
 const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
 const files=Object.fromEntries(Object.entries(contents).map(([name,value])=>[name,{count:value?value.trim().split("\n").length:0,sha256:digest(value)}]));
 const manifest={format:"zenura-firebase-read-only-export-v1",projectId:"synthetic-test",importPerformed:false,files};
 for(const [name,value] of Object.entries(contents))await fs.writeFile(path.join(input,name),value);
 await fs.writeFile(path.join(input,"manifest.json"),JSON.stringify(manifest));
 const report=await transformExport({inputDirectory:input,outputDirectory:output,userMap:map});
 const rows=(await fs.readFile(path.join(output,"paper_user_identity_map.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
 assert.deepEqual(rows,[{supabase_user_id:map["legacy-user"],firebase_uid:"legacy-user"}]);
 assert.equal(report.importAllowed,true);
 assert.equal(report.files.paper_user_identity_map.count,1);
 assert.equal(report.files.paper_watchlists.count,4);
 assert.equal(report.importOrder[0],"paper_user_identity_map");
 assert.equal(report.supabaseWrites,0);
 await fs.rm(root,{recursive:true,force:true});
});
test("quarantines Firestore data whose UID is absent from Firebase Auth export",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"zenura-orphan-"));
 const input=path.join(root,"input"),output=path.join(root,"output");
 await fs.mkdir(input);
 const auth=JSON.stringify({uid:"some-other-user"})+"\n";
 const account=JSON.stringify({collection:"indianPaperAccounts",documentId:"legacy-user",data:acct})+"\n";
 const contents={"firebase-auth-users.jsonl":auth,"indianPaperAccounts.jsonl":account,"indianPaperOrders.jsonl":"","indianDerivativeOrders.jsonl":"","indianMarketWatchlists.jsonl":""};
 const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
 const files=Object.fromEntries(Object.entries(contents).map(([name,value])=>[name,{count:value?value.trim().split("\n").length:0,sha256:digest(value)}]));
 const manifest={format:"zenura-firebase-read-only-export-v1",projectId:"synthetic-test",importPerformed:false,files};
 for(const [name,value] of Object.entries(contents))await fs.writeFile(path.join(input,name),value);
 await fs.writeFile(path.join(input,"manifest.json"),JSON.stringify(manifest));
 const report=await transformExport({inputDirectory:input,outputDirectory:output,userMap:map});
 assert.equal(report.errorCount,1);
 assert.equal(report.importAllowed,false);
 assert.equal(report.files.paper_user_identity_map,undefined);
 await fs.rm(root,{recursive:true,force:true});
});

test("rejects position fields outside Supabase column constraints",()=>{
 const tooMany={...acct,derivativePositions:{"NSE_FO|TOO-MANY":{instrumentType:"CE",netQuantity:1000001,averagePricePaise:100,costBasisPaise:100000100,exchange:"NSE",updatedAt:"2026-11-20T10:00:00Z"}}};
 assert.throws(()=>transformAccount({documentId:"legacy-user",data:tooMany},map),/position quantity/);
 const badExchange={...acct,derivativePositions:{"NSE_FO|BAD":{instrumentType:"CE",netQuantity:1,averagePricePaise:100,costBasisPaise:100,exchange:"BFO",updatedAt:"2026-11-20T10:00:00Z"}}};
 assert.throws(()=>transformAccount({documentId:"legacy-user",data:badExchange},map),/derivative exchange/);
 const badDate={...acct,derivativePositions:{"NSE_FO|DATE":{instrumentType:"PE",netQuantity:1,averagePricePaise:100,costBasisPaise:100,exchange:"NSE",expiry:"2026-02-30",updatedAt:"2026-11-20T10:00:00Z"}}};
 assert.throws(()=>transformAccount({documentId:"legacy-user",data:badDate},map),/calendar date/);
});
test("rejects equity LIMIT order missing required limit_price_paise",()=>{
 const record={documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:1,orderType:"LIMIT",status:"PENDING",createdAt:"2026-11-20T10:00:00Z",updatedAt:"2026-11-20T10:00:00Z"}};
 assert.throws(()=>transformEquityOrder(record,map),/requires a positive limit price/);
});
test("rejects uppercase legacy order hashes that violate SQL regex",()=>{
 const record={documentId:"A".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_EQ|ABC",side:"BUY",quantity:1,orderType:"MARKET",status:"FILLED",createdAt:"2026-11-20T10:00:00Z",updatedAt:"2026-11-20T10:00:00Z"}};
 assert.throws(()=>transformEquityOrder(record,map),/Invalid legacy order hash/);
});
test("rejects derivative orders with invalid calendar dates or oversized lots",()=>{
 const base={documentId:"a".repeat(64),data:{uid:"legacy-user",requestFingerprint:"b".repeat(64),instrumentKey:"NSE_FO|ABC",side:"BUY",quantity:1,instrumentType:"CE",lots:1,lotSize:1,status:"FILLED",executionPricePaise:100,quoteTimestampMs:1000,quoteAgeMs:100,grossPaise:100,chargesPaise:0,cashDeltaPaise:-100,createdAt:"2026-11-20T10:00:00Z"}};
 assert.throws(()=>transformDerivativeOrder({...base,data:{...base.data,expiry:"2026-02-30"}},map),/calendar date/);
 assert.throws(()=>transformDerivativeOrder({...base,data:{...base.data,lots:10001,quantity:10001}},map),/lots/);
});
