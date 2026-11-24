"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const workspace=fs.readFileSync(path.join(root,"markets/stocks/order-workspace.js"),"utf8");
const stocks=fs.readFileSync(path.join(root,"markets/stocks/stocks.js"),"utf8");
const html=fs.readFileSync(path.join(root,"markets/stocks/index.html"),"utf8");

test("order workspace sends the opaque backend cursor only for append requests",()=>{
  assert.match(workspace,/const cursor = append \? nextCursor : null/);
  assert.match(workspace,/if \(cursor\) params\.set\('cursor', cursor\)/);
  assert.match(workspace,/currentOrders = append \? currentOrders\.concat\(incoming\) : incoming/);
  assert.match(workspace,/nextCursor = data\.nextCursor \|\| null; hasMore = !!data\.hasMore && !!nextCursor/);
  assert.match(workspace,/loadMore\?\.addEventListener\('click', \(\) => loadOrders\(\{append:true\}\)\)/);
});

test("order workspace invalidates in-flight history and clears private rows on account transition",()=>{
  assert.match(workspace,/requestSeq\+\+; balanceRequest\+\+/);
  assert.match(workspace,/currentOrders = \[\]; nextCursor = null; hasMore = false/);
  assert.match(workspace,/if \(seq !== requestSeq \|\| connector\.getUserId\(\) !== uid\) return/);
});

test("stock portfolio history uses cursor pagination and does not discard earlier pages",()=>{
  assert.match(stocks,/if\(append\)params\.set\('cursor',cursor\)/);
  assert.match(stocks,/paperHistoryCursor=data\.nextCursor\|\|null/);
  assert.match(stocks,/paperHistoryHasMore=!!data\.hasMore&&!!paperHistoryCursor/);
  assert.match(stocks,/if\(!append\)paperHistory\.textContent=''/);
  assert.match(stocks,/paperHistoryMore\?\.addEventListener\('click',\(\)=>loadPaperHistory\(\{append:true\}\)\)/);
});

test("stock history pagination invalidates old account responses and blocks duplicate loads",()=>{
  assert.match(stocks,/paperHistoryLoadSeq/);
  assert.match(stocks,/if\(append&&\(paperHistoryLoading\|\|!paperHistoryHasMore\|\|!paperHistoryCursor\)\)return/);
  assert.match(stocks,/connector\.getUserId\(\)!==uid/);
});

test("stock terminal contains an accessible load-older-orders control",()=>{
  assert.match(html,/id="paper-history-more"/);
});
