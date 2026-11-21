"use strict";
// Isolated Upstox OAuth foundation for Indian Market mode.
// Secrets are provisioned with Firebase Secret Manager; never expose them to browser code.
const crypto = require("node:crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { processPendingLimitOrders } = require("./lib/pending-limit-order-worker");
const { isPendingLimitWorkerEnabled } = require("./lib/pending-limit-worker-gate");
const logger = require("firebase-functions/logger");
const { connectionStatus } = require("./lib/upstox-connection-status");
const { disconnectUpstoxAccount: disconnectUpstoxAccountForUser, isOAuthGenerationCurrent, connectionGeneration } = require("./lib/upstox-disconnect");
const { isOAuthStateUsable } = require("./lib/upstox-oauth-state");
const { nextUpstoxTokenExpiry } = require("./lib/upstox-token-expiry");
const { isUsableUpstoxTokenResponse } = require("./lib/upstox-token-response");
const { isUsableUpstoxOAuthCallback } = require("./lib/upstox-oauth-callback-input");
const { decodeUpstoxEncryptionKey } = require("./lib/upstox-encryption-key");
const { isVerifiedPasswordAccount } = require("./lib/upstox-email-verification");
const { parseUpstoxV3Quote } = require("./lib/upstox-v3-quote");
const db = getFirestore();
const CLIENT_ID = defineSecret("UPSTOX_CLIENT_ID");
const CLIENT_SECRET = defineSecret("UPSTOX_CLIENT_SECRET");
const REDIRECT_URI = defineSecret("UPSTOX_REDIRECT_URI");
const TOKEN_ENCRYPTION_KEY = defineSecret("UPSTOX_TOKEN_ENCRYPTION_KEY");
const REGION = "asia-south1";
function uidOf(req) {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth.uid;
}
function encryptToken(value) {
  const key = decodeUpstoxEncryptionKey(TOKEN_ENCRYPTION_KEY.value());
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {v:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:encrypted.toString("base64")};
}
exports.startUpstoxAuthorization = onCall(
  {region:REGION,secrets:[CLIENT_ID,REDIRECT_URI]},
  async req => {
    const uid=uidOf(req);
    if (!isVerifiedPasswordAccount(req.auth)) {
      throw new HttpsError("failed-precondition", "Verify your email address before connecting Upstox.");
    }
    const state=crypto.randomBytes(32).toString("hex");
    const controlSnap=await db.collection("upstoxConnectionControls").doc(uid).get();
    const generation=connectionGeneration(controlSnap.exists?controlSnap.data():null);
    await db.collection("upstoxOAuthStates").doc(state).create({
      uid,generation,createdAt:FieldValue.serverTimestamp(),
      expiresAt:Timestamp.fromMillis(Date.now()+10*60*1000),used:false
    });
    const url=new URL("https://api.upstox.com/v2/login/authorization/dialog");
    url.searchParams.set("response_type","code");
    url.searchParams.set("client_id",CLIENT_ID.value());
    url.searchParams.set("redirect_uri",REDIRECT_URI.value());
    url.searchParams.set("state",state);
    return {authorizationUrl:url.toString()};
  }
);
exports.upstoxOAuthCallback = onRequest(
  {region:REGION,secrets:[CLIENT_ID,CLIENT_SECRET,REDIRECT_URI,TOKEN_ENCRYPTION_KEY]},
  async (req,res) => {
    if(req.method!=="GET") return res.status(405).send("Method not allowed");
    const code=typeof req.query.code==="string"?req.query.code:"";
    const state=typeof req.query.state==="string"?req.query.state:"";
    if(!isUsableUpstoxOAuthCallback(code,state)) return res.status(400).send("Invalid authorization response.");
    const stateRef=db.collection("upstoxOAuthStates").doc(state);
    try {
      // Atomically consume the state before contacting Upstox. This prevents
      // parallel callback replays from exchanging the same authorization code.
      let stateData;
      const claimed=await db.runTransaction(async tx=>{
        const snap=await tx.get(stateRef);
        if(!snap.exists) return false;
        const data=snap.data();
        if(!isOAuthStateUsable(data)) return false;
        stateData=data;
        tx.update(stateRef,{used:true,usedAt:FieldValue.serverTimestamp()});
        return true;
      });
      if(!claimed) return res.status(400).send("Authorization session expired or already used. Start again.");
      const form=new URLSearchParams({
        code,client_id:CLIENT_ID.value(),client_secret:CLIENT_SECRET.value(),
        redirect_uri:REDIRECT_URI.value(),grant_type:"authorization_code"
      });
      const response=await fetch("https://api.upstox.com/v2/login/authorization/token",{
        method:"POST",headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},
        body:form.toString(),
        signal:AbortSignal.timeout(15000)
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!isUsableUpstoxTokenResponse(payload)) {
        logger.warn("Upstox token exchange rejected",{status:response.status});
        return res.status(502).send("Upstox authorization could not be completed. Return to the app and retry.");
      }
      const encrypted=encryptToken(payload.access_token);
      const accountRef=db.collection("upstoxConnections").doc(stateData.uid);
      const controlRef=db.collection("upstoxConnectionControls").doc(stateData.uid);
      const saved=await db.runTransaction(async tx=>{
        const controlSnap=await tx.get(controlRef);
        const control=controlSnap.exists?controlSnap.data():null;
        if(!isOAuthGenerationCurrent(control,stateData.generation)) return false;
        tx.set(accountRef,{
          tokenCiphertext:encrypted,tokenType:payload.token_type||"Bearer",
          expiresAt:Timestamp.fromMillis(nextUpstoxTokenExpiry()),
          authorizedAt:FieldValue.serverTimestamp(),provider:"upstox",status:"connected"
        });
        return true;
      });
      if(!saved) return res.status(409).send("This connection attempt was cancelled. Return to the app and connect again.");
      return res.redirect(303,"https://zenuraignite.com/markets/stocks/?upstox=connected");
    } catch(error) {
      logger.error("Upstox OAuth callback failed",{errorName:error.name||"Error"});
      return res.status(500).send("Authorization could not be saved securely. Please retry.");
    }
  }
);
exports.disconnectUpstoxAccount = onCall(
  {region:REGION},
  async req=>{
    const uid=uidOf(req);
    return disconnectUpstoxAccountForUser(db,uid,Date.now());
  }
);
exports.getIndianMarketConnectionStatus = onCall(
  {region:REGION},
  async req=>{
    const uid=uidOf(req), snap=await db.collection("upstoxConnections").doc(uid).get();
    if(!snap.exists) return {connected:false,feedReady:false,status:"not_connected"};
    return connectionStatus(snap.data());
  }
);

const {decryptPendingUpstoxToken}=require("./lib/upstox-token-decrypt");
function isIndianCashMarketOpen(nowMs) {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(nowMs));
  const get=type=>parts.find(part=>part.type===type)?.value;
  const weekday=get("weekday"),minutes=Number(get("hour"))*60+Number(get("minute"));
  return !["Sat","Sun"].includes(weekday)&&minutes>=555&&minutes<=930;
}
async function fetchFreshPendingLimitQuote(order) {
  if(!order||typeof order.uid!=="string"||typeof order.instrumentKey!=="string"||!order.instrumentKey)
    throw new Error("Malformed pending LIMIT order identity.");
  const connectionSnap=await db.collection("upstoxConnections").doc(order.uid).get();
  if(!connectionSnap.exists)throw new Error("Upstox connection is unavailable.");
  const connection=connectionSnap.data(),now=Date.now();
  const expiry=connection?.expiresAt?.toMillis?.();
  if(connection?.status!=="connected"||!connection.tokenCiphertext||!Number.isSafeInteger(expiry)||expiry<=now)
    throw new Error("Upstox connection token is not usable.");
  const accessToken=decryptPendingUpstoxToken(connection.tokenCiphertext,TOKEN_ENCRYPTION_KEY.value());
  const url="https://api.upstox.com/v3/market-quote/quotes?"+new URLSearchParams({instrument_key:order.instrumentKey});
  const response=await fetch(url,{headers:{Authorization:"Bearer "+accessToken,Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("Upstox quote request failed with status "+response.status+".");
  return parseUpstoxV3Quote(payload,order.instrumentKey,Date.now());

}
exports.processPendingPaperLimitOrders = onSchedule(
  {schedule:"*/1 9-15 * * 1-5",timeZone:"Asia/Kolkata",region:REGION,secrets:[TOKEN_ENCRYPTION_KEY],maxInstances:1,concurrency:1,timeoutSeconds:540},
  async event => {
    if(!isPendingLimitWorkerEnabled()){
      logger.info("Pending LIMIT worker remains disabled; explicit opt-in is required.");
      return;
    }
    const now=Date.now();
    if(!isIndianCashMarketOpen(now)){
      logger.info("Pending LIMIT worker skipped outside Indian cash-market session.");
      return;
    }
    const summary=await processPendingLimitOrders({
      db,fetchQuote:fetchFreshPendingLimitQuote,nowMs:now,maxOrders:50,
      serverTimestamp:()=>FieldValue.serverTimestamp(),logger
    });
    logger.info("Pending paper LIMIT worker completed",summary);
  }
);
