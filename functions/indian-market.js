"use strict";
// Isolated Upstox OAuth foundation for Indian Market mode.
// Secrets are provisioned with Firebase Secret Manager; never expose them to browser code.
const crypto = require("node:crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { connectionStatus } = require("./lib/upstox-connection-status");
const { isOAuthStateUsable } = require("./lib/upstox-oauth-state");
const { nextUpstoxTokenExpiry } = require("./lib/upstox-token-expiry");
const { isUsableUpstoxTokenResponse } = require("./lib/upstox-token-response");
const { isUsableUpstoxOAuthCallback } = require("./lib/upstox-oauth-callback-input");
const { decodeUpstoxEncryptionKey } = require("./lib/upstox-encryption-key");
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
    const uid=uidOf(req), state=crypto.randomBytes(32).toString("hex");
    await db.collection("upstoxOAuthStates").doc(state).create({
      uid,createdAt:FieldValue.serverTimestamp(),
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
      await accountRef.set({
        tokenCiphertext:encrypted,tokenType:payload.token_type||"Bearer",
        expiresAt:Timestamp.fromMillis(nextUpstoxTokenExpiry()),
        authorizedAt:FieldValue.serverTimestamp(),provider:"upstox",status:"connected"
      });
      return res.redirect(303,"https://zenuraignite.com/markets/stocks/?upstox=connected");
    } catch(error) {
      logger.error("Upstox OAuth callback failed",{message:error.message});
      return res.status(500).send("Authorization could not be saved securely. Please retry.");
    }
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
