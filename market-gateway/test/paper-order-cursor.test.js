"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  encodePaperOrderCursor,
  decodePaperOrderCursor,
  paperOrderCursorFilter
} = require("../lib/paper-order-cursor");

const order = {
  created_at: "2026-11-26T16:11:32.123456+00:00",
  order_id: "a".repeat(64)
};

test("paper order cursor round-trips exact timestamp precision and order ID", () => {
  const encoded = encodePaperOrderCursor(order);
  assert.deepEqual(decodePaperOrderCursor(encoded), {
    createdAt: order.created_at,
    orderId: order.order_id
  });
});

test("paper order keyset filter uses timestamp then unique order ID", () => {
  const cursor = decodePaperOrderCursor(encodePaperOrderCursor(order));
  assert.equal(
    paperOrderCursorFilter(cursor),
    "created_at.lt." + order.created_at
      + ",and(created_at.eq." + order.created_at + ",order_id.lt." + order.order_id + ")"
  );
});

test("rejects malformed, non-canonical, oversized and tampered cursors", () => {
  for (const value of ["", "not-base64!", "e30", "A".repeat(513), "eyJ4IjoxfQ=="]) {
    assert.throws(() => decodePaperOrderCursor(value), { status: 400 });
  }
});

test("rejects invalid timestamps, order IDs and unexpected cursor fields", () => {
  const invalid = [
    { createdAt: "not-a-date", orderId: "a".repeat(64) },
    { createdAt: order.created_at, orderId: "not-an-order-id" },
    { createdAt: order.created_at, orderId: "a".repeat(64), userId: "other-user" }
  ];
  for (const payload of invalid) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    assert.throws(() => decodePaperOrderCursor(encoded), { status: 400 });
  }
});

test("paper order history endpoint applies owner-scoped stable keyset pagination", () => {
  const source = readFileSync(path.join(__dirname, "../supabase-server.js"), "utf8");
  const start = source.indexOf('app.get("/paper/orders"');
  const end = source.indexOf('app.get("/paper/portfolio"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /\.eq\("user_id",user\.id\)/);
  assert.match(route, /!\/\^\\d\+\$\/\.test\(raw\)/);
  assert.match(route, /decodePaperOrderCursor/);
  assert.match(route, /\.or\(paperOrderCursorFilter\(cursor\)\)/);
  assert.match(route, /\.order\("created_at",\{ascending:false\}\)\.order\("order_id",\{ascending:false\}\)/);
  assert.match(route, /\.limit\(limit\+1\)/);
  assert.match(route, /hasMore/);
  assert.match(route, /encodePaperOrderCursor/);
});
