"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {encodeOrderHistoryCursor,decodeOrderHistoryCursor,buildOrderHistoryCursorFilter}=require("../lib/order-history-pagination");

const order={created_at:"2026-11-24T12:30:00.123456+05:30",order_id:"a".repeat(64)};

test("order history cursor round-trips exact database timestamp precision",()=>{
  const token=encodeOrderHistoryCursor(order);
  assert.deepEqual(decodeOrderHistoryCursor(token),{createdAt:order.created_at,orderId:order.order_id});
});
test("cursor filter uses a stable descending timestamp and order ID tie-breaker",()=>{
  const cursor=decodeOrderHistoryCursor(encodeOrderHistoryCursor(order));
  assert.equal(buildOrderHistoryCursorFilter(cursor),
    "created_at.lt."+order.created_at+",and(created_at.eq."+order.created_at+",order_id.lt."+order.order_id+")");
});
test("cursor rejects malformed, oversized and non-canonical base64url input",()=>{
  for(const value of ["!","a".repeat(513),"eyJmb28iOiJiYXIifQ==","eyJmb28iOiJiYXIifQ"])
    assert.throws(()=>decodeOrderHistoryCursor(value),/cursor is invalid/i);
});
test("cursor rejects extra keys, invalid timestamp and invalid order ID",()=>{
  const invalid=[
    {createdAt:order.created_at,orderId:order.order_id,extra:true},
    {createdAt:"not-a-date",orderId:order.order_id},
    {createdAt:order.created_at,orderId:"not-an-order-id"}
  ];
  for(const value of invalid){
    const token=Buffer.from(JSON.stringify(value)).toString("base64url");
    assert.throws(()=>decodeOrderHistoryCursor(token),/cursor is invalid/i);
  }
});
test("encoder and filter reject untrusted order identifiers",()=>{
  assert.throws(()=>encodeOrderHistoryCursor({created_at:order.created_at,order_id:"x".repeat(64)}),/valid order timestamp/i);
  assert.throws(()=>buildOrderHistoryCursorFilter({createdAt:order.created_at,orderId:"x),status.eq.FILLED"}),/validated order history cursor/i);
});
