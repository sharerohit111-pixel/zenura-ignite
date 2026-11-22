"use strict";

const {isUuid}=require("../order-idempotency");

function fail(message){throw Object.assign(new Error(message),{status:400});}
function requirePaise(value,field,{allowZero=true}={}){
  if(!Number.isSafeInteger(value)||(allowZero?value<0:value<1))fail(`Invalid ${field}; expected an integer paise amount.`);
  return value;
}
function requireMap(value,field){
  if(value===undefined)return {};
  if(!value||typeof value!=="object"||Array.isArray(value))fail(`Invalid ${field}; expected an object map.`);
  return structuredClone(value);
}

/**
 * Converts a Firestore account document into a migration-staging record.
 * This is deliberately a pure function: it performs no Firebase/Supabase I/O.
 * Historical startingCashPaise is preserved; the new-user default is never applied.
 */
function normalizeFirebasePaperAccount({firebaseUid,supabaseAuthUserId,account}){
  if(typeof firebaseUid!=="string"||!firebaseUid.trim())fail("A source Firebase UID is required.");
  if(!isUuid(supabaseAuthUserId))fail("A verified Supabase Auth UUID mapping is required.");
  if(!account||typeof account!=="object"||Array.isArray(account))fail("A Firestore account document is required.");
  if(account.currency!=="INR")fail("Only INR paper accounts are supported.");
  const startingCashPaise=requirePaise(account.startingCashPaise,"startingCashPaise",{allowZero:false});
  const cashPaise=requirePaise(account.cashPaise,"cashPaise");
  const reservedCashPaise=requirePaise(account.reservedCashPaise??0,"reservedCashPaise");
  const reservedMarginPaise=requirePaise(account.reservedMarginPaise??0,"reservedMarginPaise");
  if(reservedCashPaise+reservedMarginPaise>cashPaise)fail("Reserved cash and margin exceed the account cash balance.");
  const realizedPnlPaise=requirePaise(account.realizedPnlPaise??0,"realizedPnlPaise");
  const deliveryRealizedPnlPaise=requirePaise(account.deliveryRealizedPnlPaise??realizedPnlPaise,"deliveryRealizedPnlPaise");
  const intradayRealizedPnlPaise=requirePaise(account.intradayRealizedPnlPaise??0,"intradayRealizedPnlPaise");
  const version=account.version===undefined?null:account.version;
  if(version!==null&&(!Number.isSafeInteger(version)||version<1))fail("Invalid account version.");
  return {
    sourceFirebaseUid:firebaseUid,authUserId:supabaseAuthUserId,currency:"INR",
    startingCashPaise,cashPaise,reservedCashPaise,reservedMarginPaise,
    realizedPnlPaise,deliveryRealizedPnlPaise,intradayRealizedPnlPaise,
    positions:requireMap(account.positions,"positions"),
    intradayPositions:requireMap(account.intradayPositions,"intradayPositions"),
    derivativePositions:requireMap(account.derivativePositions,"derivativePositions"),
    reservedPositions:requireMap(account.reservedPositions,"reservedPositions"),
    intradayReservedPositions:requireMap(account.intradayReservedPositions,"intradayReservedPositions"),
    version,sourceCreatedAt:account.createdAt??null,sourceUpdatedAt:account.updatedAt??null
  };
}

/**
 * Stages an existing cash-equity order without inventing a historical raw
 * idempotency UUID. The Firestore document ID and fingerprint remain canonical.
 */
function normalizeFirebaseCashOrder({firebaseUid,supabaseAuthUserId,firestoreOrderId,order}){
  if(typeof firebaseUid!=="string"||!firebaseUid.trim())fail("A source Firebase UID is required.");
  if(!isUuid(supabaseAuthUserId))fail("A verified Supabase Auth UUID mapping is required.");
  if(typeof firestoreOrderId!=="string"||!firestoreOrderId.trim())fail("The original Firestore order ID is required.");
  if(!order||typeof order!=="object"||Array.isArray(order)||order.uid!==firebaseUid)fail("The Firestore order owner does not match the source Firebase UID.");
  if(typeof order.requestFingerprint!=="string"||!order.requestFingerprint)fail("The original order fingerprint is required.");
  for(const field of ["quantity","executionPricePaise","grossPaise"])if(order[field]!==undefined)requirePaise(order[field],field,{allowZero:field==="grossPaise"});
  return {
    sourceFirebaseUid:firebaseUid,authUserId:supabaseAuthUserId,
    sourceFirestoreOrderId:firestoreOrderId,legacyIdempotencyKey:null,
    requestFingerprint:order.requestFingerprint,
    sourceOrder:structuredClone(order)
  };
}

module.exports={normalizeFirebasePaperAccount,normalizeFirebaseCashOrder};
