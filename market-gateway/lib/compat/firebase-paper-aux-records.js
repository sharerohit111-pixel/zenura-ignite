"use strict";

const {isUuid}=require("../order-idempotency");
const {WATCHLIST_NAMES,normalizeWatchlists}=require("../watchlists");

function fail(message){throw Object.assign(new Error(message),{status:400});}
function stageOrderIdentity({firebaseUid,supabaseAuthUserId,firestoreOrderId,order}){
 if(typeof firebaseUid!=="string"||!firebaseUid.trim()||!isUuid(supabaseAuthUserId))fail("Verified source and destination identities are required.");
 if(typeof firestoreOrderId!=="string"||!firestoreOrderId.trim())fail("Original Firestore order ID is required.");
 if(!order||typeof order!=="object"||Array.isArray(order)||order.uid!==firebaseUid)fail("Order owner does not match source Firebase UID.");
 if(typeof order.requestFingerprint!=="string"||!order.requestFingerprint)fail("Original request fingerprint is required.");
 return {sourceFirebaseUid:firebaseUid,authUserId:supabaseAuthUserId,sourceFirestoreOrderId:firestoreOrderId,requestFingerprint:order.requestFingerprint};
}
function normalizeFirebaseLimitOrder(args){
 const identity=stageOrderIdentity(args),o=args.order;
 if(o.orderType!=="LIMIT"||![ "PENDING","FILLED","CANCELLED","REJECTED","EXPIRED"].includes(o.status)||
   !["BUY","SELL"].includes(o.side)||o.simulationOnly!==true||
   typeof o.instrumentKey!=="string"||!o.instrumentKey||
   !Number.isSafeInteger(o.quantity)||o.quantity<1||
   !Number.isSafeInteger(o.limitPricePaise)||o.limitPricePaise<1)
   fail("Malformed Firebase LIMIT order.");
 const expected=o.limitPricePaise*o.quantity;
 if(!Number.isSafeInteger(expected))fail("LIMIT reservation amount exceeds safe integer range.");
 const reservedCash=o.reservedCashPaise??0,reservedQty=o.reservedQuantity??0;
 if(!Number.isSafeInteger(reservedCash)||reservedCash<0||!Number.isSafeInteger(reservedQty)||reservedQty<0)
   fail("Malformed LIMIT reservation metadata.");
 if(o.side==="BUY"&&(reservedQty!==0||reservedCash!==(o.status==="PENDING"&&!o.reservationReleased?expected:0)))
   fail("BUY LIMIT reservation does not reconcile with its lifecycle state.");
 if(o.side==="SELL"&&(reservedCash!==0||reservedQty!==(o.status==="PENDING"&&!o.reservationReleased?o.quantity:0)))
   fail("SELL LIMIT reservation does not reconcile with its lifecycle state.");
 return {...identity,legacyIdempotencyKey:null,order:structuredClone(o)};
}
function normalizeFirebaseDerivativeOrder(args){
 const identity=stageOrderIdentity(args),o=args.order;
 if(o.orderType!=="MARKET"||o.simulationOnly!==true||!["CE","PE"].includes(o.instrumentType)||
   !["BUY","SELL"].includes(o.side)||!Number.isSafeInteger(o.quantity)||o.quantity<1||
   !Number.isSafeInteger(o.executionPricePaise)||o.executionPricePaise<1||
   !Number.isSafeInteger(o.grossPaise)||o.grossPaise<1||
   !o.charges||typeof o.charges!=="object"||Array.isArray(o.charges))
   fail("Malformed Firebase derivative order.");
 for(const field of ["totalChargesPaise","brokeragePaise","exchangeTransactionPaise","ipftPaise","sebiPaise","stampDutyPaise","gstPaise","sttPaise"])
  if(o.charges[field]!==undefined&&(!Number.isSafeInteger(o.charges[field])||o.charges[field]<0))fail("Malformed historical derivative charge component.");
 if(o.chargesPaise!==o.charges.totalChargesPaise)fail("Derivative order charge total does not match its preserved charge breakdown.");
 return {...identity,legacyIdempotencyKey:null,order:structuredClone(o),charges:structuredClone(o.charges)};
}
function normalizeFirebaseWatchlists(data){
 const normalized=normalizeWatchlists(data);
 for(const name of WATCHLIST_NAMES){
  if(!Array.isArray(normalized[name])||normalized[name].length>50)fail("Invalid normalized watchlist.");
 }
 return normalized;
}
/** OAuth tokens, one-time states, connection envelopes and stream leases are never bulk-imported. */
function classifyFirebaseEphemeralRecord(kind){
 const excluded=["oauthState","oauthConnectionEnvelope","streamLease","connectionControl","workerCursor","marginRateLimit"];
 if(!excluded.includes(kind))fail("Unknown ephemeral Firebase record type.");
 return {kind,migratable:false,action:"recreate-after-cutover",reason:"Ephemeral credentials, one-time authorization state, leases and runtime cursors must not be bulk-migrated."};
}
module.exports={normalizeFirebaseLimitOrder,normalizeFirebaseDerivativeOrder,normalizeFirebaseWatchlists,classifyFirebaseEphemeralRecord};
