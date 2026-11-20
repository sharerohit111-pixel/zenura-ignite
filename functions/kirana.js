"use strict";
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("node:crypto");
const db = getFirestore();
const REGION = "asia-south1";

function signedIn(req) {
  if (!req.auth?.uid || !req.auth.token.email_verified) {
    throw new HttpsError("unauthenticated", "Verified sign-in is required.");
  }
  return req.auth.uid;
}
function textValue(value, label, max = 120) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max) {
    throw new HttpsError("invalid-argument", label + " is required.");
  }
  return value.trim();
}
function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) {
    throw new HttpsError("invalid-argument", "Invalid " + label + ".");
  }
  return n;
}
async function requireMember(storeId, uid, allowed = ["owner", "manager", "cashier"]) {
  const snap = await db.doc(`kiranaStores/${storeId}/members/${uid}`).get();
  if (!snap.exists || !allowed.includes(snap.data().role) || snap.data().active !== true) {
    throw new HttpsError("permission-denied", "You do not have access to this store.");
  }
  return snap.data();
}

exports.kiranaCreateStore = onCall({ region: REGION, maxInstances: 10 }, async req => {
  const uid = signedIn(req);
  const name = textValue(req.data?.name, "Store name", 100);
  const phone = textValue(req.data?.phone, "Store mobile", 20);
  const address = textValue(req.data?.address || "Not added", "Address", 250);
  const storeRef = db.collection("kiranaStores").doc();
  const memberRef = storeRef.collection("members").doc(uid);
  await db.runTransaction(async tx => {
    tx.create(storeRef, {
      name, phone, address, ownerUid: uid, status: "active",
      currency: "INR", timezone: "Asia/Kolkata",
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    tx.create(memberRef, {
      uid, role: "owner", active: true,
      permissions: ["products", "billing", "customers", "suppliers", "reports", "settings"],
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return { storeId: storeRef.id, name };
});

exports.kiranaListMyStores = onCall({ region: REGION }, async req => {
  const uid = signedIn(req);
  const memberships = await db.collectionGroup("members").where("uid", "==", uid).get();
  const rows = await Promise.all(memberships.docs.map(async m => {
    const store = await m.ref.parent.parent.get();
    return store.exists && m.data().active === true ? { storeId: store.id, name: store.data().name, role: m.data().role } : null;
  }));
  return { stores: rows.filter(Boolean) };
});

exports.kiranaAddProduct = onCall({ region: REGION, maxInstances: 20 }, async req => {
  const uid = signedIn(req);
  const storeId = textValue(req.data?.storeId, "Store");
  const name = textValue(req.data?.name, "Product name", 120);
  const sku = textValue(req.data?.sku || ("SKU-" + crypto.randomBytes(4).toString("hex").toUpperCase()), "SKU", 40);
  const unit = textValue(req.data?.unit || "piece", "Unit", 20);
  const retailPrice = positiveNumber(req.data?.retailPrice, "retail price");
  const wholesalePrice = req.data?.wholesalePrice == null ? retailPrice : positiveNumber(req.data.wholesalePrice, "wholesale price");
  const openingStock = Number(req.data?.openingStock ?? 0);
  if (!Number.isFinite(openingStock) || openingStock < 0 || openingStock > 100000000) throw new HttpsError("invalid-argument", "Invalid opening stock.");
  const lowStockAt = Number(req.data?.lowStockAt ?? 0);
  if (!Number.isFinite(lowStockAt) || lowStockAt < 0 || lowStockAt > 100000000) throw new HttpsError("invalid-argument", "Invalid low-stock threshold.");
  const ref = db.collection("kiranaStores").doc(storeId).collection("products").doc();
  const storeRef = db.collection("kiranaStores").doc(storeId);
  await db.runTransaction(async tx => {
    const memberSnap = await tx.get(storeRef.collection("members").doc(uid));
    if (!memberSnap.exists || memberSnap.data().active !== true || !["owner", "manager"].includes(memberSnap.data().role)) {
      throw new HttpsError("permission-denied", "You cannot add products to this store.");
    }
    tx.create(ref, {
      name, sku, unit, retailPrice, wholesalePrice, stock: openingStock,
      lowStockAt,
      barcode: String(req.data?.barcode || "").slice(0, 80),
      active: true, createdBy: uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { productId: ref.id };
});

exports.kiranaListProducts = onCall({ region: REGION }, async req => {
  const uid = signedIn(req);
  const storeId = textValue(req.data?.storeId, "Store");
  await requireMember(storeId, uid);
  const snap = await db.collection("kiranaStores").doc(storeId).collection("products").where("active", "==", true).limit(500).get();
  return { products: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
});

exports.kiranaCreateSale = onCall({ region: REGION, maxInstances: 30 }, async req => {
  const uid = signedIn(req);
  const storeId = textValue(req.data?.storeId, "Store");
  await requireMember(storeId, uid);
  const items = req.data?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new HttpsError("invalid-argument", "Add between 1 and 100 bill items.");
  const normalized = items.map(item => ({
    productId: textValue(item?.productId, "Product"),
    quantity: positiveNumber(item?.quantity, "quantity"),
    priceType: item?.priceType === "wholesale" ? "wholesale" : "retail"
  }));
  const paymentMode = ["cash", "upi", "card", "credit"].includes(req.data?.paymentMode) ? req.data.paymentMode : "cash";
  const customerId = paymentMode === "credit" ? textValue(req.data?.customerId, "Customer") : "";
  const storeRef = db.collection("kiranaStores").doc(storeId);
  const saleRef = storeRef.collection("sales").doc();
  const productRefs = [...new Map(normalized.map(x => [x.productId, storeRef.collection("products").doc(x.productId)])).values()];
  let invoiceNo = "";
  let total = 0;
  await db.runTransaction(async tx => {
    const memberSnap = await tx.get(storeRef.collection("members").doc(uid));
    if (!memberSnap.exists || memberSnap.data().active !== true || !["owner", "manager", "cashier"].includes(memberSnap.data().role)) {
      throw new HttpsError("permission-denied", "You cannot create bills for this store.");
    }
    const productSnaps = [];
    for (const ref of productRefs) productSnaps.push(await tx.get(ref));
    const customerRef = customerId ? storeRef.collection("customers").doc(customerId) : null;
    const customerSnap = customerRef ? await tx.get(customerRef) : null;
    if (customerRef && (!customerSnap.exists || customerSnap.data().active !== true)) throw new HttpsError("not-found", "Selected customer is unavailable.");
    const byId = new Map(productSnaps.map(s => [s.id, s]));
    const lines = normalized.map(item => {
      const snap = byId.get(item.productId);
      if (!snap?.exists || snap.data().active !== true) throw new HttpsError("not-found", "A product in this bill is unavailable.");
      const p = snap.data();
      const price = item.priceType === "wholesale" ? p.wholesalePrice : p.retailPrice;
      if (typeof price !== "number" || p.stock < item.quantity) throw new HttpsError("failed-precondition", "Insufficient stock or invalid product price for " + p.name + ".");
      return { productId: snap.id, name: p.name, sku: p.sku, unit: p.unit, quantity: item.quantity, price, amount: Math.round(item.quantity * price * 100) / 100 };
    });
    total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    for (const ref of productRefs) {
      const snap = byId.get(ref.id);
      const soldQty = lines.filter(line => line.productId === ref.id).reduce((sum, line) => sum + line.quantity, 0);
      if (snap.data().stock < soldQty) throw new HttpsError("failed-precondition", "Insufficient combined stock for " + snap.data().name + ".");
      tx.update(ref, { stock: snap.data().stock - soldQty, updatedAt: FieldValue.serverTimestamp() });
    }
    invoiceNo = "KRN-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    tx.create(saleRef, {
      invoiceNo, items: lines, subtotal: total, tax: 0, discount: 0, total,
      paymentMode, customerId: customerId || null,
      customerName: customerSnap ? customerSnap.data().name : String(req.data?.customerName || "Walk-in Customer").slice(0, 100),
      createdBy: uid, createdAt: FieldValue.serverTimestamp(), status: "completed"
    });
    if (customerRef) {
      const ledgerRef = customerRef.collection("ledger").doc("sale_" + saleRef.id);
      tx.update(customerRef, { creditBalance: FieldValue.increment(total), totalCredit: FieldValue.increment(total), updatedAt: FieldValue.serverTimestamp() });
      tx.create(ledgerRef, { type: "credit_sale", amount: total, invoiceId: invoiceNo, saleId: saleRef.id, createdBy: uid, createdAt: FieldValue.serverTimestamp(), note: "Counter billing credit sale" });
    }
  });
  return { saleId: saleRef.id, invoiceNo, total };
});
