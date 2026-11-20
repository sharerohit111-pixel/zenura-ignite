"use strict";
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const db = getFirestore();
const REGION = "asia-south1";
function requireUid(req) {
  if (!req.auth?.uid || !req.auth.token.email_verified) throw new HttpsError("unauthenticated", "Verified sign-in is required.");
  return req.auth.uid;
}
function requiredText(v, label, max=120) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new HttpsError("invalid-argument", label + " is required.");
  return v.trim();
}
function moneyAmount(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000 || Math.round(amount * 100) !== amount * 100) {
    throw new HttpsError("invalid-argument", "Enter a valid " + label + " (maximum two decimal places).");
  }
  return Math.round(amount * 100) / 100;
}
async function member(storeId, uid, roles=["owner","manager","cashier"]) {
  const s=await db.doc(`kiranaStores/${storeId}/members/${uid}`).get();
  if(!s.exists || s.data().active!==true || !roles.includes(s.data().role)) throw new HttpsError("permission-denied","Store access denied.");
  return s.data();
}
exports.kiranaAddCustomer = onCall({region:REGION}, async req=>{
  const uid=requireUid(req), storeId=requiredText(req.data?.storeId,"Store");
  await member(storeId,uid,["owner","manager","cashier"]);
  const name=requiredText(req.data?.name,"Customer name");
  const phone=String(req.data?.phone||"").trim();
  if(phone && !/^[0-9+ -]{7,20}$/.test(phone)) throw new HttpsError("invalid-argument","Enter a valid customer mobile number.");
  const ref=db.collection("kiranaStores").doc(storeId).collection("customers").doc();
  await ref.create({name,phone,creditBalance:0,totalCredit:0,totalPaid:0,active:true,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  return {customerId:ref.id};
});
exports.kiranaListCustomers = onCall({region:REGION}, async req=>{
  const uid=requireUid(req), storeId=requiredText(req.data?.storeId,"Store");
  await member(storeId,uid);
  const snap=await db.collection("kiranaStores").doc(storeId).collection("customers").where("active","==",true).limit(500).get();
  return {customers:snap.docs.map(d=>({id:d.id,...d.data()}))};
});
exports.kiranaRecordCreditPayment = onCall({region:REGION}, async req=>{
  const uid=requireUid(req), storeId=requiredText(req.data?.storeId,"Store"), customerId=requiredText(req.data?.customerId,"Customer");
  const amount=moneyAmount(req.data?.amount,"payment amount");
  const mode=["cash","upi","card","bank"].includes(req.data?.paymentMode)?req.data.paymentMode:"cash";
  const store=db.collection("kiranaStores").doc(storeId), customer=store.collection("customers").doc(customerId), payment=customer.collection("ledger").doc();
  await db.runTransaction(async tx=>{
    const memberRef=store.collection("members").doc(uid);
    const [m,c]=await Promise.all([tx.get(memberRef),tx.get(customer)]);
    if(!m.exists||m.data().active!==true||!["owner","manager","cashier"].includes(m.data().role)) throw new HttpsError("permission-denied","Store access denied.");
    if(!c.exists||c.data().active!==true) throw new HttpsError("not-found","Customer not found.");
    const balance=Number(c.data().creditBalance||0);
    if(amount>balance) throw new HttpsError("failed-precondition","Payment cannot exceed the outstanding balance.");
    tx.update(customer,{creditBalance:Math.round((balance-amount)*100)/100,totalPaid:FieldValue.increment(amount),updatedAt:FieldValue.serverTimestamp()});
    tx.create(payment,{type:"payment",amount,mode,createdBy:uid,createdAt:FieldValue.serverTimestamp(),note:String(req.data?.note||"").slice(0,200)});
  });
  return {paymentId:payment.id};
});
exports.kiranaGetCustomerLedger = onCall({region:REGION}, async req=>{
  const uid=requireUid(req), storeId=requiredText(req.data?.storeId,"Store"), customerId=requiredText(req.data?.customerId,"Customer");
  await member(storeId,uid);
  const customer=db.collection("kiranaStores").doc(storeId).collection("customers").doc(customerId);
  const [c,entries]=await Promise.all([customer.get(),customer.collection("ledger").orderBy("createdAt","desc").limit(200).get()]);
  if(!c.exists) throw new HttpsError("not-found","Customer not found.");
  return {customer:{id:c.id,...c.data()},entries:entries.docs.map(d=>({id:d.id,...d.data()}))};
});

exports.kiranaRecordCustomerCredit = onCall({region:REGION}, async req=>{
  const uid=requireUid(req), storeId=requiredText(req.data?.storeId,"Store"), customerId=requiredText(req.data?.customerId,"Customer");
  const amount=moneyAmount(req.data?.amount,"credit amount"), invoiceId=requiredText(req.data?.invoiceId,"Invoice reference",80);
  const safeInvoiceId=invoiceId.replace(/[^A-Za-z0-9_-]/g,"_");
  if(!safeInvoiceId || !/[A-Za-z0-9]/.test(safeInvoiceId)) throw new HttpsError("invalid-argument","Invoice reference must contain a letter or number.");
  const store=db.collection("kiranaStores").doc(storeId), customer=store.collection("customers").doc(customerId), entry=customer.collection("ledger").doc("sale_"+safeInvoiceId);
  await db.runTransaction(async tx=>{
    const memberRef=store.collection("members").doc(uid);
    const [m,c,e]=await Promise.all([tx.get(memberRef),tx.get(customer),tx.get(entry)]);
    if(!m.exists||m.data().active!==true||!["owner","manager","cashier"].includes(m.data().role)) throw new HttpsError("permission-denied","Store access denied.");
    if(!c.exists||c.data().active!==true) throw new HttpsError("not-found","Customer not found.");
    if(e.exists) throw new HttpsError("already-exists","This invoice is already recorded in the ledger.");
    tx.update(customer,{creditBalance:FieldValue.increment(amount),totalCredit:FieldValue.increment(amount),updatedAt:FieldValue.serverTimestamp()});
    tx.create(entry,{type:"credit_sale",amount,invoiceId,createdBy:uid,createdAt:FieldValue.serverTimestamp(),note:String(req.data?.note||"").slice(0,200)});
  });
  return {entryId:entry.id};
});
