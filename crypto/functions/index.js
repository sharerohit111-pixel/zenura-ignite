'use strict';

const crypto = require('node:crypto');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();
const db = admin.firestore();

const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');

const PLANS = Object.freeze({
  month_1: { label: '1 Month', amount: 9900, months: 1 },
  month_3: { label: '3 Months', amount: 19900, months: 3 },
  month_6: { label: '6 Months', amount: 39900, months: 6 },
  year_1: { label: '1 Year', amount: 79900, months: 12 }
});
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

function razorpay() {
  return new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
}
function requireUser(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Please sign in to continue.');
  return request.auth.uid;
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex'), right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
async function ensureTrial(uid) {
  const ref = db.collection('zenuraEntitlements').doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const now = new Date();
    if (!snap.exists) {
      const trialEndsAt = new Date(now.getTime() + TRIAL_MS);
      tx.create(ref, {
        uid,
        trialStartedAt: admin.firestore.Timestamp.fromDate(now),
        trialEndsAt: admin.firestore.Timestamp.fromDate(trialEndsAt),
        premiumUntil: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { status: 'trial', canTrade: true, trialEndsAt: trialEndsAt.toISOString(), premiumUntil: null };
    }
    const data = snap.data();
    const premiumUntil = data.premiumUntil && data.premiumUntil.toDate ? data.premiumUntil.toDate() : null;
    const trialEndsAt = data.trialEndsAt && data.trialEndsAt.toDate ? data.trialEndsAt.toDate() : null;
    if (premiumUntil && premiumUntil.getTime() > now.getTime()) {
      return { status: 'premium', canTrade: true, premiumUntil: premiumUntil.toISOString(), trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null };
    }
    const trialActive = !!trialEndsAt && trialEndsAt.getTime() > now.getTime();
    return { status: trialActive ? 'trial' : 'expired', canTrade: trialActive, trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null, premiumUntil: premiumUntil ? premiumUntil.toISOString() : null };
  });
}
async function activatePaidOrder(orderId, paymentId, paymentAmount, paymentCurrency) {
  const orderRef = db.collection('zenuraPremiumOrders').doc(orderId);
  return db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error('Unknown payment order.');
    const order = orderSnap.data();
    if (order.status === 'paid') return { alreadyProcessed: true, uid: order.uid };
    if (order.status !== 'created') throw new Error('Order is not payable.');
    if (order.amount !== paymentAmount || order.currency !== paymentCurrency || paymentCurrency !== 'INR') throw new Error('Payment amount or currency mismatch.');
    const plan = PLANS[order.planId];
    if (!plan) throw new Error('Invalid subscription plan.');
    const entitlementRef = db.collection('zenuraEntitlements').doc(order.uid);
    const entitlementSnap = await tx.get(entitlementRef);
    const current = entitlementSnap.exists && entitlementSnap.data().premiumUntil && entitlementSnap.data().premiumUntil.toDate
      ? entitlementSnap.data().premiumUntil.toDate() : null;
    const now = new Date();
    const startsAt = current && current > now ? current : now;
    const premiumUntil = addMonths(startsAt, plan.months);
    tx.set(entitlementRef, {
      uid: order.uid,
      premiumPlan: order.planId,
      premiumStartedAt: admin.firestore.Timestamp.fromDate(startsAt),
      premiumUntil: admin.firestore.Timestamp.fromDate(premiumUntil),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.update(orderRef, {
      status: 'paid',
      paymentId,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      premiumUntil: admin.firestore.Timestamp.fromDate(premiumUntil)
    });
    return { alreadyProcessed: false, uid: order.uid, premiumUntil: premiumUntil.toISOString() };
  });
}

exports.getPremiumEntitlement = onCall(async request => {
  const uid = requireUser(request);
  return ensureTrial(uid);
});

exports.createPremiumOrder = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async request => {
  const uid = requireUser(request);
  const planId = request.data && request.data.planId;
  const plan = PLANS[planId];
  if (!plan) throw new HttpsError('invalid-argument', 'Please select a valid Premium plan.');
  await ensureTrial(uid);
  const client = razorpay();
  const order = await client.orders.create({
    amount: plan.amount,
    currency: 'INR',
    receipt: ('zi_' + uid.slice(0, 12) + '_' + Date.now()).slice(0, 40),
    notes: { uid, planId, product: 'ZENURA_IGNITE_PREMIUM' }
  });
  await db.collection('zenuraPremiumOrders').doc(order.id).create({
    uid, planId, amount: plan.amount, currency: 'INR', status: 'created',
    razorpayOrderId: order.id, createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { orderId: order.id, amount: plan.amount, currency: 'INR', keyId: RAZORPAY_KEY_ID.value(), plan: plan.label };
});

exports.verifyPremiumPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async request => {
  const uid = requireUser(request);
  const data = request.data || {};
  const orderId = String(data.razorpay_order_id || '');
  const paymentId = String(data.razorpay_payment_id || '');
  const signature = String(data.razorpay_signature || '');
  if (!orderId || !paymentId || !signature) throw new HttpsError('invalid-argument', 'Payment verification details are incomplete.');
  const orderRef = db.collection('zenuraPremiumOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists || orderSnap.data().uid !== uid) throw new HttpsError('permission-denied', 'This payment order does not belong to this account.');
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET.value()).update(orderId + '|' + paymentId).digest('hex');
  if (!safeEqualHex(expected, signature)) throw new HttpsError('permission-denied', 'Payment signature verification failed.');
  const payment = await razorpay().payments.fetch(paymentId);
  if (payment.order_id !== orderId || payment.status !== 'captured') throw new HttpsError('failed-precondition', 'Payment is not captured for this order.');
  try {
    const result = await activatePaidOrder(orderId, paymentId, payment.amount, payment.currency);
    return { verified: true, alreadyProcessed: !!result.alreadyProcessed, premiumUntil: result.premiumUntil || null };
  } catch (error) {
    throw new HttpsError('failed-precondition', error.message || 'Unable to activate Premium.');
  }
});

exports.razorpayWebhook = onRequest({ secrets: [RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const signature = req.get('x-razorpay-signature') || '';
  const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET.value()).update(req.rawBody).digest('hex');
  if (!safeEqualHex(expected, signature)) return res.status(400).send('Invalid webhook signature');
  const event = req.body && req.body.event;
  const payment = req.body && req.body.payload && req.body.payload.payment && req.body.payload.payment.entity;
  if (event === 'payment.captured' && payment && payment.order_id) {
    try {
      await activatePaidOrder(payment.order_id, payment.id, payment.amount, payment.currency);
    } catch (error) {
      console.error('Premium webhook activation failed:', error.message);
      return res.status(500).send('Activation pending retry');
    }
  }
  return res.status(200).send('ok');
});
