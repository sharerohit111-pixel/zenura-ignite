"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateWatchlistController } from "../../markets/stocks/demo-watchlist-persistence.mjs";

function fakeSupabase(seed = {}) {
  const rows = new Map(Object.entries(seed));
  const calls = [];
  return {
    auth: {}, rows, calls,
    from(table) {
      assert.equal(table, "paper_watchlists");
      let uid = null;
      return {
        select() {
          return { eq: async (_column, value) => {
            uid = value;
            calls.push({ type: "select", uid });
            return { data: [...(rows.get(uid)?.values() || [])].map(row => ({ ...row, instrument_keys: [...row.instrument_keys] })), error: null };
          }};
        },
        upsert(payload, options) {
          calls.push({ type: "upsert", payload: structuredClone(payload), options });
          return Promise.resolve().then(() => {
            const account = rows.get(payload.user_id) || new Map();
            account.set(payload.name, { ...payload, instrument_keys: [...payload.instrument_keys] });
            rows.set(payload.user_id, account);
            return { error: null };
          });
        }
      };
    }
  };
}

test("private watchlist controller loads only rows for the authenticated owner", async () => {
  const supabase = fakeSupabase({
    userA: new Map([["My Stocks", { name: "My Stocks", instrument_keys: ["MOCK|A"] }]]),
    userB: new Map([["My Stocks", { name: "My Stocks", instrument_keys: ["MOCK|B"] }]])
  });
  const controller = createPrivateWatchlistController({ supabase, catalogKeys: ["MOCK|A", "MOCK|B"] });
  controller.reset("userA");
  assert.deepEqual((await controller.load()).keys, ["MOCK|A"]);
  controller.reset("userB");
  assert.deepEqual((await controller.load()).keys, ["MOCK|B"]);
  assert.deepEqual(supabase.calls.filter(x => x.type === "select").map(x => x.uid), ["userA", "userB"]);
});

test("account switching invalidates late responses and clears in-memory private data", async () => {
  let resolveQuery;
  const supabase = {
    auth: {},
    from() {
      return { select() { return { eq() { return new Promise(resolve => { resolveQuery = resolve; }); } }; } };
    }
  };
  const controller = createPrivateWatchlistController({ supabase, catalogKeys: ["MOCK|A"] });
  controller.reset("userA");
  const pending = controller.load();
  controller.reset("userB");
  resolveQuery({ data: [{ name: "My Stocks", instrument_keys: ["MOCK|A"] }], error: null });
  assert.deepEqual(await pending, { stale: true, keys: [] });
  assert.deepEqual(controller.keys, []);
  assert.equal(controller.userId, "userB");
});

test("writes carry the authenticated owner, named-list key and canonical instrument order", async () => {
  const supabase = fakeSupabase();
  const controller = createPrivateWatchlistController({ supabase, catalogKeys: ["MOCK|A", "MOCK|B"] });
  controller.reset("userA");
  controller.setActiveName("NIFTY");
  await controller.mutate(["MOCK|B", "MOCK|A", "MOCK|B"]);
  const write = supabase.calls.find(x => x.type === "upsert");
  assert.equal(write.payload.user_id, "userA");
  assert.equal(write.payload.name, "NIFTY");
  assert.deepEqual(write.payload.instrument_keys, ["MOCK|B", "MOCK|A"]);
  assert.equal(write.options.onConflict, "user_id,name");
});

test("queued write keeps its original list name if the user switches lists before it runs", async () => {
  let release;
  const calls = [];
  const supabase = {
    auth: {},
    from() {
      return {
        upsert(payload) {
          calls.push(payload);
          if (calls.length === 1) return new Promise(resolve => { release = () => resolve({ error: null }); });
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  const controller = createPrivateWatchlistController({ supabase, catalogKeys: ["MOCK|A", "MOCK|B"] });
  controller.reset("userA");
  const first = controller.mutate(["MOCK|A"]);
  controller.setActiveName("Banking");
  const second = controller.mutate(["MOCK|B"]);
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls.map(x => x.name), ["My Stocks", "Banking"]);
});

test("rejects invalid list names and over-limit writes", async () => {
  const controller = createPrivateWatchlistController({ supabase: fakeSupabase(), catalogKeys: ["MOCK|A"] });
  controller.reset("userA");
  assert.throws(() => controller.setActiveName("Other"), /Invalid watchlist name/);
  await assert.rejects(controller.mutate(Array.from({ length: 51 }, (_, i) => "MOCK|" + i)), /up to 50/);
});
