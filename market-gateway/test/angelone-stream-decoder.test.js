"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeAngelOneBinaryFeedPacket, decodeAndNormalizeAngelOneBinaryFeedPacket } = require("../lib/angelone-stream-decoder");

function packet(mode = 3, exchangeType = 1) {
  const size = ({1:51,2:123,3:379})[mode];
  const b = Buffer.alloc(size);
  b.writeUInt8(mode,0); b.writeUInt8(exchangeType,1);
  b.write("3045","utf8",2);
  b.writeBigInt64LE(123456n,27);
  b.writeBigInt64LE(1795500000000n,35);
  b.writeBigInt64LE(56820n,43);
  if(mode >= 2) {
    b.writeBigInt64LE(10n,51);
    b.writeBigInt64LE(56780n,59);
    b.writeBigInt64LE(100000n,67);
    b.writeDoubleLE(1000,75); b.writeDoubleLE(900,83);
    b.writeBigInt64LE(56700n,91); b.writeBigInt64LE(57000n,99);
    b.writeBigInt64LE(56000n,107); b.writeBigInt64LE(56750n,115);
  }
  if(mode === 3) {
    b.writeBigInt64LE(1795500000000n,123);
    b.writeBigInt64LE(200000n,131);
    // Best five: one bid and one ask. The remaining slots are empty.
    b.writeUInt16LE(1,147); b.writeBigInt64LE(20n,149);
    b.writeBigInt64LE(56800n,157); b.writeUInt16LE(2,165);
    b.writeUInt16LE(0,167); b.writeBigInt64LE(30n,169);
    b.writeBigInt64LE(56850n,177); b.writeUInt16LE(3,185);
    b.writeBigInt64LE(60000n,347); b.writeBigInt64LE(50000n,355);
    b.writeBigInt64LE(65000n,363); b.writeBigInt64LE(40000n,371);
  }
  return b;
}

test("decodes documented Angel One LTP packet in little-endian paise", () => {
  const result=decodeAngelOneBinaryFeedPacket(packet(1));
  assert.equal(result.mode,1);
  assert.equal(result.exchange,"NSE");
  assert.equal(result.symbolToken,"3045");
  assert.equal(result.lastPricePaise,56820);
  assert.equal(result.lastTradeTimestampMs,undefined);
});

test("decodes documented Quote packet fields without inventing trade timestamp", () => {
  const result=decodeAngelOneBinaryFeedPacket(packet(2,3));
  assert.equal(result.exchange,"BSE");
  assert.equal(result.closePricePaise,56750);
  assert.equal(result.volume,100000);
  assert.equal(result.lastTradeTimestampMs,undefined);
});

test("decodes Snap Quote last trade timestamp and best-five depth", () => {
  const result=decodeAngelOneBinaryFeedPacket(packet(3));
  assert.equal(result.lastTradeTimestampMs,1795500000000);
  assert.deepEqual(result.bids,[{pricePaise:56800,quantity:20,orders:2}]);
  assert.deepEqual(result.asks,[{pricePaise:56850,quantity:30,orders:3}]);
  assert.equal(result.openInterest,200000);
  assert.equal(result.upperCircuitPaise,60000);
});

test("rejects unknown exchange, truncated/oversized frames and malformed tokens", () => {
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(Buffer.alloc(1)),{code:"invalid_market_data"});
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(packet(3).subarray(0,123)),{code:"invalid_market_data"});
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(packet(3,5)),{code:"invalid_market_data"});
  const bad=packet(1); bad.fill(0x41,2,27);
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(bad),{code:"invalid_market_data"});
});

test("rejects malformed depth and crossed best bid/ask", () => {
  const bad=packet(3);
  bad.writeBigInt64LE(56900n,177);
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(bad),{code:"invalid_market_data"});
  const badFlag=packet(3); badFlag.writeUInt16LE(9,147);
  assert.throws(()=>decodeAngelOneBinaryFeedPacket(badFlag),{code:"invalid_market_data"});
});

test("normalizes only fresh Snap Quote packets with exact entitlement-bound native mapping", () => {
  const now=1795500000000;
  const key="1:3045";
  const mapping={nativeSymbolToken:"3045",exchangeType:1,instrumentId:"NSE_EQ|INE002A01018",exchange:"NSE",entitlementReference:"approved-rights-ref"};
  const result=decodeAndNormalizeAngelOneBinaryFeedPacket(packet(3),{
    now,maxAgeMs:15000,instrumentMap:{[key]:mapping}
  });
  assert.equal(result.lastPricePaise,56820);
  assert.equal(result.instrumentId,"NSE_EQ|INE002A01018");
  assert.equal(result.entitlementReference,"approved-rights-ref");
  assert.equal(result.attribution.displayName,"Angel One SmartAPI");
});

test("does not invent trade time for LTP/Quote or accept stale and mismatched mappings", () => {
  const now=1795500000000;
  assert.equal(decodeAndNormalizeAngelOneBinaryFeedPacket(packet(1),{now,instrumentMap:{}}),null);
  assert.equal(decodeAndNormalizeAngelOneBinaryFeedPacket(packet(2),{now,instrumentMap:{}}),null);
  assert.equal(decodeAndNormalizeAngelOneBinaryFeedPacket(packet(3),{
    now:1795500000000+30000,maxAgeMs:15000,
    instrumentMap:{"1:3045":{nativeSymbolToken:"3045",exchangeType:1,instrumentId:"NSE_EQ|INE002A01018",exchange:"NSE",entitlementReference:"rights"}}
  }),null);
  assert.equal(decodeAndNormalizeAngelOneBinaryFeedPacket(packet(3),{
    now,maxAgeMs:15000,
    instrumentMap:{"1:3045":{nativeSymbolToken:"9999",exchangeType:1,instrumentId:"NSE_EQ|INE002A01018",exchange:"NSE",entitlementReference:"rights"}}
  }),null);
});
