"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vectors=require("./fixtures/supabase-option-charge-parity-vectors.json");
const {calculateLongOptionTradeCharges}=require("../lib/trading-charges");

test("shared option charge vectors match the Firebase reference implementation",()=>{
  assert.equal(vectors.schemaVersion,1);
  assert.ok(vectors.vectors.length>=1);
  for(const vector of vectors.vectors){
    const actual=calculateLongOptionTradeCharges(vector.input);
    for(const [field,expected] of Object.entries(vector.expected)){
      assert.equal(actual[field],expected,`${vector.id}: ${field}`);
    }
  }
});
