"use strict";
const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();
const KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const PLANS = Object.freeze({
  month_1:{label:"1 Month",amount:9900,days:30},
  month_3:{label:"3 Months",amount:19900,days:90},
  month_6:{label:"6 Months",amount:39900,days:180},
  year_1:{label:"1 Year",amount:79900,days:365}
});
function uidOf(req) {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated","Sign in first.");
  return req.auth.uid;
}
function safeHexEqual(a,b) {
  if (typeof a!=="string" || typeof b!=="string") return false;
  const x=Buffer.from(a,"hex"), y=Buffer.from(b,"hex");
  return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y);
}
async function razorpayPost(path,body) {
  const auth="Basic "+Buffer.from(KEY_ID.value()+":"+KEY_SECRET.value()).toString("base64");
  const response=await fetch("https://api.razorpay.com/v1"+path,{
    method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    logger.error("Razorpay API error",{path,status:response.status});
    throw new HttpsError("failed-precondition","Payment provider request failed.");
  }
  return data;
}

exports.createPremiumOrder=onCall(
  {secrets:[KEY_ID,KEY_SECRET],region:"asia-south1"},
  async req=>{
    const uid=uidOf(req), planId=req.data?.planId, plan=PLANS[planId];
    if(!plan) throw new HttpsError("invalid-argument","Invalid Premium plan.");
    const order=await razorpayPost("/orders",{
      amount:plan.amount,currency:"INR",
      receipt:("zi_"+crypto.randomUUID()).slice(0,40),
      notes:{uid,planId,product:"ZENURA_IGNITE_PREMIUM"}
    });
    await db.collection("paymentOrders").doc(order.id).create({
      uid,planId,amount:plan.amount,currency:"INR",providerOrderId:order.id,
      status:"created",createdAt:FieldValue.serverTimestamp()
    });
    return {orderId:order.id,amount:plan.amount,currency:"INR",keyId:KEY_ID.value(),planLabel:plan.label};
  }
);

exports.verifyPremiumCheckout=onCall(
  {secrets:[KEY_SECRET],region:"asia-south1"},
  async req=>{
    const uid=uidOf(req), {orderId,paymentId,signature}=req.data||{};
    if(![orderId,paymentId,signature].every(v=>typeof v==="string"&&v.length<256))
      throw new HttpsError("invalid-argument","Invalid verification details.");
    const ref=db.collection("paymentOrders").doc(orderId), snap=await ref.get();
    if(!snap.exists||snap.data().uid!==uid)
      throw new HttpsError("permission-denied","Order does not belong to this account.");
    const expected=crypto.createHmac("sha256",KEY_SECRET.value()).update(orderId+"|"+paymentId).digest("hex");
    if(!safeHexEqual(signature,expected))
      throw new HttpsError("permission-denied","Payment signature verification failed.");
    await ref.set({checkoutSignatureVerified:true,providerPaymentId:paymentId,verificationRequestedAt:FieldValue.serverTimestamp()},{merge:true});
    return {verified:true,entitlementPendingProviderConfirmation:true};
  }
);

exports.razorpayWebhook=onRequest(
  {secrets:[WEBHOOK_SECRET],region:"asia-south1"},
  async(req,res)=>{
    if(req.method!=="POST") return res.status(405).send("Method not allowed");
    const signature=req.get("x-razorpay-signature")||"", eventId=req.get("x-razorpay-event-id")||"";
    const raw=req.rawBody;
    const expected=crypto.createHmac("sha256",WEBHOOK_SECRET.value()).update(raw).digest("hex");
    if(!safeHexEqual(signature,expected)) return res.status(401).send("Invalid signature");
    let event;
    try{event=JSON.parse(raw.toString("utf8"));}catch(_){return res.status(400).send("Invalid JSON");}
    const key=eventId||crypto.createHash("sha256").update(raw).digest("hex");
    const eventRef=db.collection("razorpayEvents").doc(key);
    try{
      await db.runTransaction(async tx=>{
        const prior=await tx.get(eventRef);
        if(prior.exists) return;
        let orderRef=null, order=null, entRef=null, current={};
        const payment=event.event==="payment.captured"?event.payload?.payment?.entity:null;
        if(payment?.order_id&&payment.currency==="INR"&&payment.status==="captured"){
          orderRef=db.collection("paymentOrders").doc(payment.order_id);
          const orderSnap=await tx.get(orderRef);
          if(orderSnap.exists){
            order=orderSnap.data();
            if(order.status!=="captured"&&payment.amount===order.amount&&PLANS[order.planId]){
              entRef=db.collection("entitlements").doc(order.uid);
              const entSnap=await tx.get(entRef);
              current=entSnap.exists?entSnap.data():{};
            }else order=null;
          }
        }
        // Firestore requires every transaction read to happen before its first write.
        tx.create(eventRef,{event:event.event||"unknown",receivedAt:FieldValue.serverTimestamp(),processed:false});
        if(!order) return;
        const now=Timestamp.now();
        const base=current.currentPeriodEnd&&current.currentPeriodEnd.toMillis()>now.toMillis()
          ?current.currentPeriodEnd.toMillis():now.toMillis();
        const end=Timestamp.fromMillis(base+PLANS[order.planId].days*86400000);
        tx.set(orderRef,{status:"captured",providerPaymentId:payment.id,capturedAt:FieldValue.serverTimestamp()},{merge:true});
        tx.set(entRef,{
          uid:order.uid,status:"premium",planId:order.planId,
          currentPeriodStart:current.currentPeriodStart||now,currentPeriodEnd:end,
          autoRenew:false,provider:"razorpay",updatedAt:FieldValue.serverTimestamp()
        },{merge:true});
        tx.set(eventRef,{processed:true},{merge:true});
      });
      return res.status(200).send("ok");
    }catch(error){logger.error("Webhook processing failed",error);return res.status(500).send("Retry later");}
  }
);

exports.getPremiumAccess=onCall({region:"asia-south1"},async req=>{
  const uid=uidOf(req), ref=db.collection("entitlements").doc(uid);
  let data;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists){
      const now=Timestamp.now(), end=Timestamp.fromMillis(now.toMillis()+72*60*60*1000);
      data={uid,status:"trial",trialStartedAt:now,trialEndsAt:end,autoRenew:false,updatedAt:now};
      tx.create(ref,data);
    }else data=snap.data();
  });
  const now=Date.now();
  const premium=data.status==="premium"&&data.currentPeriodEnd?.toMillis()>now;
  const trial=data.status==="trial"&&data.trialEndsAt?.toMillis()>now;
  return {
    access:!!(premium||trial),status:premium?"premium":trial?"trial":"expired",
    trialEndsAt:data.trialEndsAt?.toMillis()||null,
    premiumEndsAt:data.currentPeriodEnd?.toMillis()||null
  };
});

exports.authorizePaperOrder=onCall({region:"asia-south1"},async req=>{
  const uid=uidOf(req), snap=await db.collection("entitlements").doc(uid).get();
  if(!snap.exists) throw new HttpsError("permission-denied","Start your demo first.");
  const data=snap.data(), now=Date.now();
  const trial=data.status==="trial"&&data.trialEndsAt?.toMillis()>now;
  const premium=data.status==="premium"&&data.currentPeriodEnd?.toMillis()>now;
  if(!trial&&!premium) throw new HttpsError("permission-denied","Demo ended. Activate Premium to place orders.");
  return {authorized:true};
});


// Mega Kirana callable backend modules. Registered for the production Functions deploy; backend module export verified.
Object.assign(exports, require("./kirana"));
Object.assign(exports, require("./kirana-ledger"));

// Supabase Firebase third-party Auth role claim (inert until the readiness flag is enabled).
Object.assign(exports, require("./supabase-auth-claims"));
