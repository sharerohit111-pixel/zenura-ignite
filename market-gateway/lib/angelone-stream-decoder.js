"use strict";

// Angel One SmartAPI WebSocket 2.0 binary packet decoder.
// Layout follows the published little-endian LTP / Quote / Snap Quote contract.
// This module parses transport bytes only; it does not authorize a provider,
// resolve a canonical instrument, assert data rights, or open a WebSocket.

const EXCHANGES = Object.freeze({
  1: Object.freeze({ exchange: "NSE", segment: "NSE_CM" }),
  2: Object.freeze({ exchange: "NSE", segment: "NSE_FO" }),
  3: Object.freeze({ exchange: "BSE", segment: "BSE_CM" }),
  4: Object.freeze({ exchange: "BSE", segment: "BSE_FO" }),
});
const PACKET_LENGTHS = Object.freeze({ 1: 51, 2: 123, 3: 379 });

function invalid(message) {
  throw Object.assign(new Error(message), { status: 409, code: "invalid_market_data" });
}
function safeNumber(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) invalid("Angel One packet contains an unsafe " + field + ".");
  return n;
}
function readI64(buffer, offset, field) {
  return safeNumber(buffer.readBigInt64LE(offset), field);
}
function readPricePaise(buffer, offset, field) {
  const value = readI64(buffer, offset, field);
  return value > 0 ? value : null;
}
function readToken(buffer) {
  const bytes = buffer.subarray(2, 27);
  const end = bytes.indexOf(0);
  const tokenBytes = end < 0 ? bytes : bytes.subarray(0, end);
  const token = tokenBytes.toString("utf8");
  if (!token || !/^[0-9]{1,25}$/.test(token) ||
      !Buffer.from(token, "utf8").equals(tokenBytes)) {
    invalid("Angel One packet contains an invalid native instrument token.");
  }
  return token;
}
function decodeBestFive(buffer) {
  const bids = [];
  const asks = [];
  for (let i = 0; i < 10; i++) {
    const offset = 147 + i * 20;
    const flag = buffer.readUInt16LE(offset);
    if (flag !== 0 && flag !== 1) invalid("Angel One depth packet contains an unknown side flag.");
    const quantity = readI64(buffer, offset + 2, "depth quantity");
    const pricePaise = readPricePaise(buffer, offset + 10, "depth price");
    const orders = buffer.readUInt16LE(offset + 18);
    if (quantity < 0) invalid("Angel One depth quantity cannot be negative.");
    if (quantity === 0 && pricePaise === null && orders === 0) continue;
    if (quantity <= 0 || pricePaise === null || orders <= 0) {
      invalid("Angel One depth level is incomplete.");
    }
    (flag === 1 ? bids : asks).push(Object.freeze({ pricePaise, quantity, orders }));
  }
  for (let i = 1; i < bids.length; i++) {
    if (bids[i - 1].pricePaise <= bids[i].pricePaise) invalid("Angel One bid levels are not strictly descending.");
  }
  for (let i = 1; i < asks.length; i++) {
    if (asks[i - 1].pricePaise >= asks[i].pricePaise) invalid("Angel One ask levels are not strictly ascending.");
  }
  if (bids.length && asks.length && bids[0].pricePaise >= asks[0].pricePaise) {
    invalid("Angel One returned a crossed best-five book.");
  }
  return { bids: Object.freeze(bids), asks: Object.freeze(asks) };
}

function decodeAngelOneBinaryFeedPacket(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError("Angel One feed packet must be binary.");
  }
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length < 2) invalid("Angel One feed packet is truncated.");
  const mode = buffer.readUInt8(0);
  const exchangeType = buffer.readUInt8(1);
  const expectedLength = PACKET_LENGTHS[mode];
  if (!expectedLength || buffer.length !== expectedLength) {
    invalid("Angel One feed packet length does not match its subscription mode.");
  }
  const exchangeInfo = EXCHANGES[exchangeType];
  if (!exchangeInfo) invalid("Angel One exchange type is not supported for NSE/BSE paper-market data.");

  const token = readToken(buffer);
  const sequenceNumber = readI64(buffer, 27, "sequence number");
  const exchangeTimestampMs = readI64(buffer, 35, "exchange timestamp");
  const lastPricePaise = readPricePaise(buffer, 43, "last traded price");
  if (exchangeTimestampMs <= 0 || !lastPricePaise) invalid("Angel One packet has an invalid timestamp or last traded price.");

  const result = {
    providerId: "angelone",
    mode,
    exchangeType,
    exchange: exchangeInfo.exchange,
    exchangeSegment: exchangeInfo.segment,
    symbolToken: token,
    sequenceNumber,
    exchangeTimestampMs,
    lastPricePaise,
  };

  if (mode >= 2) {
    result.lastTradeQuantity = readI64(buffer, 51, "last trade quantity");
    result.averagePricePaise = readPricePaise(buffer, 59, "average price");
    result.volume = readI64(buffer, 67, "daily volume");
    result.totalBuyQuantity = buffer.readDoubleLE(75);
    result.totalSellQuantity = buffer.readDoubleLE(83);
    result.openPricePaise = readPricePaise(buffer, 91, "open price");
    result.highPricePaise = readPricePaise(buffer, 99, "high price");
    result.lowPricePaise = readPricePaise(buffer, 107, "low price");
    result.closePricePaise = readPricePaise(buffer, 115, "close price");
    if (result.lastTradeQuantity < 0 || result.volume < 0 ||
        !Number.isFinite(result.totalBuyQuantity) || result.totalBuyQuantity < 0 ||
        !Number.isFinite(result.totalSellQuantity) || result.totalSellQuantity < 0) {
      invalid("Angel One quote packet contains invalid quantities.");
    }
  }
  if (mode === 3) {
    result.lastTradeTimestampMs = readI64(buffer, 123, "last trade timestamp");
    result.openInterest = readI64(buffer, 131, "open interest");
    // Offset 139 is explicitly documented by Angel One as a dummy/garbage field.
    const { bids, asks } = decodeBestFive(buffer);
    result.bids = bids;
    result.asks = asks;
    result.upperCircuitPaise = readPricePaise(buffer, 347, "upper circuit");
    result.lowerCircuitPaise = readPricePaise(buffer, 355, "lower circuit");
    result.weekHighPaise = readPricePaise(buffer, 363, "52-week high");
    result.weekLowPaise = readPricePaise(buffer, 371, "52-week low");
    if (result.lastTradeTimestampMs <= 0 || result.openInterest < 0) {
      invalid("Angel One snap-quote packet contains an invalid trade timestamp or open interest.");
    }
  }
  return Object.freeze(result);
}

module.exports = { decodeAngelOneBinaryFeedPacket, PACKET_LENGTHS, EXCHANGES };
