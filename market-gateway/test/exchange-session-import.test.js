"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseExchangeSessionCsv}=require("../lib/exchange-session-import");
const now=new Date(Date.now()-1000).toISOString();
const header="exchange,session_date,is_trading_day,open_minute,close_minute,session_kind,source_reference,verified_at";
function row(exchange,date,trading,open,close,kind,url,verified=now){
 return [exchange,date,trading,open,close,kind,url,verified].join(",");
}
test("parses explicit NSE and BSE regular, special and closed sessions",()=>{
 const csv=[header,
  row("NSE","2026-11-23","true",555,930,"REGULAR","https://www.nseindia.com/market-data/holidays"),
  row("BSE","2026-11-23","true",555,930,"REGULAR","https://www.bseindia.com/markets/market-info"),
  row("BSE","2026-11-24","true",600,900,"SPECIAL","https://www.bseindia.com/notice"),
  row("NSE","2026-11-25","false","","","CLOSED","https://www.nseindia.com/holidays")
 ].join("\n");
 const sessions=parseExchangeSessionCsv(csv);
 assert.equal(sessions.length,4);
 assert.equal(sessions[1].exchange,"BSE");
 assert.equal(sessions[2].session_kind,"SPECIAL");
 assert.equal(sessions[3].is_trading_day,false);
 assert.equal(sessions[3].open_minute,null);
});
test("strips BOM, supports quoted official URLs and normalizes verified timestamps",()=>{
 const csv="\uFEFF"+header+"\n"+row("BSE","2026-11-23","true",555,930,"REGULAR",'"https://www.bseindia.com/path,with,commas"');
 const sessions=parseExchangeSessionCsv(csv);
 assert.equal(sessions[0].source_reference,"https://www.bseindia.com/path,with,commas");
 assert.ok(sessions[0].verified_at.endsWith("Z"));
});
test("rejects duplicate dates, invalid source hosts, stale timestamps and malformed windows",()=>{
 assert.throws(()=>parseExchangeSessionCsv([header,row("NSE","2026-11-23","true",555,930,"REGULAR","https://www.nseindia.com"),row("NSE","2026-11-23","true",555,930,"REGULAR","https://www.nseindia.com")].join("\n")),/Duplicate exchange session/);
 assert.throws(()=>parseExchangeSessionCsv([header,row("BSE","2026-11-23","true",555,930,"REGULAR","https://evil.example")].join("\n")),/invalid exchange/);
 assert.throws(()=>parseExchangeSessionCsv([header,row("NSE","2026-11-23","true",540,930,"REGULAR","https://www.nseindia.com")].join("\n")),/invalid open\/close/);
 assert.throws(()=>parseExchangeSessionCsv([header,row("BSE","2026-11-23","false",555,930,"CLOSED","https://www.bseindia.com")].join("\n")),/Closed exchange session/);
 assert.throws(()=>parseExchangeSessionCsv([header,row("BSE","2026-11-23","true",555,930,"REGULAR","https://www.bseindia.com",new Date(Date.now()+60000).toISOString())].join("\n")),/verification timestamp/);
});
test("rejects trailing characters after a quoted exchange-session CSV field",()=>{
 const malformed=[header,row("BSE","2026-11-23","true",555,930,"REGULAR",'"https://www.bseindia.com"suffix')].join("\n");
 assert.throws(()=>parseExchangeSessionCsv(malformed),/characters after a quoted field/);
 const stray=[header,row("BSE","2026-11-23","true",555,930,"REGULAR",'https://www.bseindia.com"')].join("\n");
 assert.throws(()=>parseExchangeSessionCsv(stray),/quote placement/);
});
test("rejects malformed headers, dates and quoted CSV",()=>{
 assert.throws(()=>parseExchangeSessionCsv("exchange,date\nBSE,2026-11-23"),/header/);
 assert.throws(()=>parseExchangeSessionCsv([header,row("BSE","2026-02-30","true",555,930,"REGULAR","https://www.bseindia.com")].join("\n")),/invalid exchange/);
 assert.throws(()=>parseExchangeSessionCsv(header+"\n\"BSE,2026-11-23,true,555,930,REGULAR,https://www.bseindia.com,2026-11-23T00:00:00Z"),/unterminated/);
});
