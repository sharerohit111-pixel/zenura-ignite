"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {encodeHistoryCursor,decodeHistoryCursor,applyHistoryCursor,paginateHistoryRows}=require("../lib/history-cursor");

test("history cursor round-trips an ISO timestamp and safe order identifier",()=>{
 const row={created_at:"2026-11-23T10:15:30.123456+00:00",order_id:"a".repeat(64)};
 const encoded=encodeHistoryCursor(row);
 assert.match(encoded,/^[A-Za-z0-9_-]+$/);
 assert.deepEqual(decodeHistoryCursor(encoded),{ok:true,cursor:{createdAt:row.created_at,orderId:row.order_id}});
});
test("history cursor rejects malformed, oversized and unsafe payloads",()=>{
 for(const value of ["!", "x".repeat(513),Buffer.from(JSON.stringify({createdAt:"2026-11-23T10:00:00Z",orderId:"x),user_id.eq.other"})).toString("base64url"),Buffer.from("{}").toString("base64url")]){
  assert.equal(decodeHistoryCursor(value).ok,false);
 }
 assert.deepEqual(decodeHistoryCursor(undefined),{ok:true,cursor:null});
});
test("history cursor applies a composite descending keyset boundary",()=>{
 let expression=null;
 const query={or(value){expression=value;return this;}};
 const cursor={createdAt:"2026-11-23T10:15:30.000Z",orderId:"b".repeat(64)};
 assert.equal(applyHistoryCursor(query,cursor),query);
 assert.equal(expression,"created_at.lt.2026-11-23T10:15:30.000Z,and(created_at.eq.2026-11-23T10:15:30.000Z,order_id.lt."+cursor.orderId+")");
 assert.equal(applyHistoryCursor(query,null),query);
});
test("history pagination returns an extra-row-derived hasMore and next cursor",()=>{
 const rows=[
  {created_at:"2026-11-23T10:03:00Z",order_id:"c".repeat(64)},
  {created_at:"2026-11-23T10:02:00Z",order_id:"b".repeat(64)},
  {created_at:"2026-11-23T10:01:00Z",order_id:"a".repeat(64)}
 ];
 const page=paginateHistoryRows(rows,2);
 assert.deepEqual(page.rows,rows.slice(0,2));
 assert.equal(page.hasMore,true);
 assert.deepEqual(decodeHistoryCursor(page.nextCursor),{ok:true,cursor:{createdAt:rows[1].created_at,orderId:rows[1].order_id}});
 const last=paginateHistoryRows(rows.slice(0,2),2);
 assert.equal(last.hasMore,false);
 assert.equal(last.nextCursor,null);
});
