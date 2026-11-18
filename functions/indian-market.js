"use strict";
// Isolated Upstox OAuth foundation for Indian Market mode.
// Secrets are provisioned with Firebase Secret Manager; never expose them to browser code.
const crypto = require("node:crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
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
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY.value(), "base64");
  if (key.length !== 32) throw new Error("UPSTOX_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
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
    if(!code||!state||!/^[a-f0-9]{64}$/.test(state)) return res.status(400).send("Invalid authorization response.");
    const stateRef=db.collection("upstoxOAuthStates").doc(state);
    try {
      const snap=await stateRef.get();
      if(!snap.exists) return res.status(400).send("Authorization session not found.");
      const stateData=snap.data();
      if(stateData.used||!stateData.expiresAt||stateData.expiresAt.toMillis()<=Date.now())
        return res.status(400).send("Authorization session expired. Start again.");
      const form=new URLSearchParams({
        code,client_id:CLIENT_ID.value(),client_secret:CLIENT_SECRET.value(),
        redirect_uri:REDIRECT_URI.value(),grant_type:"authorization_code"
      });
      const response=await fetch("https://api.upstox.com/v2/login/authorization/token",{
        method:"POST",headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},
        body:form.toString()
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||typeof payload.access_token!=="string") {
        logger.warn("Upstox token exchange rejected",{status:response.status});
        return res.status(502).send("Upstox authorization could not be completed. Return to the app and retry.");
      }
      const encrypted=encryptToken(payload.access_token);
      await db.runTransaction(async tx=>{
        const fresh=await tx.get(stateRef);
        if(!fresh.exists||fresh.data().used||fresh.data().expiresAt.toMillis()<=Date.now())
          throw new Error("OAuth state already used or expired.");
        const accountRef=db.collection("upstoxConnections").doc(stateData.uid);
        tx.set(accountRef,{
          tokenCiphertext:encrypted,tokenType:payload.token_type||"Bearer",
          expiresAt:Timestamp.fromMillis(Date.now()+Number(payload.expires_in||86400)*1000),
          authorizedAt:FieldValue.serverTimestamp(),provider:"upstox",status:"connected"
        });
        tx.update(stateRef,{used:true,usedAt:FieldValue.serverTimestamp()});
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
    const data=snap.data(), valid=data.status==="connected"&&!!data.expiresAt&&data.expiresAt.toMillis()>Date.now();
    const status=valid?"authorized_feed_not_configured":data.status==="connected"?"token_expired":"not_connected";
    return {connected:valid,feedReady:false,status,
      expiresAt:data.expiresAt?.toMillis()||null};
  }
);
