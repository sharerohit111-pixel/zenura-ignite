"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {readUserUpstoxConnection} = require("../lib/upstox-user-connection");

function fakeServiceDb(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({table});
      return {
        select(columns) {
          calls.push({select:columns});
          return {
            eq(column, value) {
              calls.push({eq:[column,value]});
              return {
                maybeSingle: async () => ({data:rows.get(value) || null,error:null})
              };
            }
          };
        }
      };
    }
  };
}

test("Upstox connection lookup is strictly scoped to the authenticated user ID", async () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const rowA = {user_id:userA,token_ciphertext:{data:"cipher-A"}};
  const rowB = {user_id:userB,token_ciphertext:{data:"cipher-B"}};
  const db = fakeServiceDb(new Map([[userA,rowA],[userB,rowB]]));

  const resultA = await readUserUpstoxConnection(db,userA);
  const resultB = await readUserUpstoxConnection(db,userB);

  assert.equal(resultA.data,rowA);
  assert.equal(resultB.data,rowB);
  assert.deepEqual(db.calls.filter(x=>x.eq).map(x=>x.eq),[
    ["user_id",userA],["user_id",userB]
  ]);
});

test("rejects missing or unverified user identifiers before querying", async () => {
  const db = fakeServiceDb(new Map());
  for (const value of [undefined,null,"", "   ",42,{}]) {
    await assert.rejects(() => readUserUpstoxConnection(db,value),TypeError);
  }
  assert.equal(db.calls.length,0);
});
