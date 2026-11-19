/* ZENURA IGNITE — UPI manual payment + admin approval.
 * Client-only UI. Firestore rules enforce ownership and admin-only approvals.
 * This does NOT verify bank receipt automatically; admin must match UTR in bank/UPI app.
 */
(() => {
  'use strict';
  const ADMIN_EMAIL = 'sharerohit111@gmail.com';
  const UPI_ID = '9756591106-4@axl';
  const PAYEE_NAME = 'Rohit Kumar';
  const PLANS = {
    monthly: {label:'1 Month', amount:99, months:1},
    quarterly: {label:'3 Months', amount:199, months:3},
    halfyear: {label:'6 Months', amount:399, months:6},
    yearly: {label:'1 Year', amount:799, months:12}
  };
  const $ = id => document.getElementById(id);
  if (!window.firebase || !firebase.apps.length || !firebase.firestore) {
    const status = $('premiumStatus');
    if (status) status.textContent = 'Payment module unavailable: Firebase setup could not be loaded.';
    return;
  }
  const auth = firebase.auth();
  const db = firebase.firestore();
  let selectedPlan = null;
  let paymentLanguage = (() => { try { return localStorage.getItem('zenura-crypto-payment-language') === 'hi' ? 'hi' : 'en'; } catch (_) { return 'en'; } })();
  const words = {en:['UPI Payment','Plan:','Amount:','Scan this QR with any UPI app. The selected plan amount is pre-filled. Confirm the payee name and amount in your UPI app, then authorize the payment with your UPI PIN.','Scan QR to Pay','UPI transaction ID / UTR','Enter UTR after successful payment','After paying, enter the UTR and submit. Premium stays pending until the admin checks the actual bank/UPI credit and approves it. Do not submit a UPI PIN or OTP.','I have paid — Submit for review','Cancel','Payment is not verified yet.'],hi:['UPI भुगतान','प्लान:','राशि:','इस QR को किसी भी UPI ऐप से स्कैन करें। चुने गए प्लान की राशि पहले से भरी होगी। भुगतान से पहले UPI ऐप में प्राप्तकर्ता का नाम और राशि जाँचें, फिर अपना UPI PIN डालकर भुगतान अधिकृत करें।','QR स्कैन करके भुगतान करें','UPI ट्रांज़ैक्शन ID / UTR','सफल भुगतान के बाद UTR दर्ज करें','भुगतान करने के बाद UTR दर्ज करके सबमिट करें। एडमिन द्वारा बैंक/UPI में वास्तविक राशि की जाँच और मंज़ूरी के बाद ही Premium सक्रिय होगा। UPI PIN या OTP यहाँ दर्ज न करें।','भुगतान कर दिया — जाँच के लिए भेजें','रद्द करें','भुगतान की अभी पुष्टि नहीं हुई है।']};
  const t = i => words[paymentLanguage][i];
  function setPaymentLanguage(lang, utr) { paymentLanguage=lang; try { localStorage.setItem('zenura-crypto-payment-language',lang); } catch (_) {} $('zpayTitle').textContent=t(0); $('zpayLanguage').textContent=lang==='en'?'हिंदी':'English'; if(selectedPlan) openPayment(selectedPlan.key,utr||''); }

  const style = document.createElement('style');
  style.textContent = `
    .zpay-shade{position:fixed;inset:0;background:#000c;z-index:80;display:none;overflow:auto;padding:18px}
    .zpay-shade.open{display:grid;place-items:center}
    .zpay-box{width:min(520px,100%);max-height:92vh;overflow:auto;background:#0d1d30;border:1px solid #31516c;border-radius:18px;padding:18px;color:#eaf2fa}
    .zpay-box h2{font:700 21px 'Space Grotesk';margin:5px 0 12px}\n    .zpay-head-actions{display:flex;align-items:center;gap:8px}\n    .zpay-lang{border:1px solid #287b76;border-radius:9px;padding:8px 11px;background:#123c42;color:#63e5c2;font:700 11px 'Space Grotesk';cursor:pointer;white-space:nowrap}
    .zpay-muted{font-size:11px;color:#91a7bb;line-height:1.55}\n    .zpay-qr-wrap{display:grid;place-items:center;gap:9px;margin:14px auto;padding:14px;width:min(100%,290px);border:1px solid #34516c;border-radius:14px;background:#f8fafc;color:#142236}\n    .zpay-qr-wrap canvas{display:block;width:240px;height:240px;max-width:100%;image-rendering:pixelated}\n    .zpay-qr-caption{font-size:10px;font-weight:800;letter-spacing:.8px;color:#24364a}\n    .zpay-qr-error{font-size:11px;color:#b45309;text-align:center}
    .zpay-input{width:100%;margin:7px 0 12px;padding:12px;border-radius:9px;border:1px solid #34516c;background:#071522;color:#fff}
    .zpay-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
    .zpay-actions button,.zpay-row button{border:0;border-radius:9px;padding:11px 14px;background:linear-gradient(100deg,#23cba4,#548dff);color:#061522;font-weight:800}
    .zpay-actions .secondary,.zpay-row .secondary{background:#1a3047;color:#dce9f5;border:1px solid #34516c}
    .zadmin-list{display:grid;gap:10px;margin-top:14px}
    .zadmin-card{border:1px solid #29435c;background:#10243a;border-radius:12px;padding:13px}
    .zadmin-card b,.zadmin-card small{display:block;overflow-wrap:anywhere}
    .zadmin-card small{color:#91a7bb;margin:5px 0;font-size:10px}
    .zadmin-row{display:flex;gap:8px;margin-top:10px}.zadmin-row button{flex:1}
    .zadmin-status{font-size:11px;color:#9bdcc8;min-height:18px}
    @media(max-width:420px){.zpay-shade{padding:8px}.zpay-box{padding:14px}}
  `;
  document.head.appendChild(style);

  const shade = document.createElement('div');
  shade.className = 'zpay-shade';
  shade.id = 'zpayShade';
  shade.innerHTML = `<section class="zpay-box" role="dialog" aria-modal="true" aria-labelledby="zpayTitle">
    <div class="head"><h2 id="zpayTitle">UPI Payment</h2><div class="zpay-head-actions"><button class="zpay-lang" id="zpayLanguage" type="button">हिंदी</button><button class="reset" id="zpayClose" type="button">✕</button></div></div>
    <div id="zpayBody"></div><p class="zadmin-status" id="zpayStatus" aria-live="polite"></p>
  </section>`;
  document.body.appendChild(shade);
  const body = $('zpayBody');
  const status = $('zpayStatus');
  const say = t => { status.textContent = t; };
  const open = () => shade.classList.add('open');
  const close = () => shade.classList.remove('open');
  $('zpayClose').onclick = close;
  $('zpayLanguage').onclick = () => setPaymentLanguage(paymentLanguage==='en'?'hi':'en',$('zpayUtr')?.value||'');
  setPaymentLanguage(paymentLanguage);
  shade.addEventListener('click', e => { if (e.target === shade) close(); });

  function requireUser() {
    const user = auth.currentUser;
    if (!user) {
      say('Please sign in with Google or Email first.');
      const authShade = $('authShade');
      if (authShade) authShade.classList.add('open');
      return null;
    }
    return user;
  }
  function openPayment(planKey, keepUtr = '') {
    const user = requireUser();
    if (!user) return;
    const plan = PLANS[planKey];
    if (!plan) return;
    selectedPlan = {key:planKey, ...plan};
    const note = 'ZENURA ' + plan.label + ' ' + user.uid.slice(0,8);
    const upi = 'upi://pay?pa=' + encodeURIComponent(UPI_ID) +
      '&pn=' + encodeURIComponent(PAYEE_NAME) +
      '&am=' + encodeURIComponent(String(plan.amount)) +
      '&cu=INR&tn=' + encodeURIComponent(note);
    body.innerHTML = `
      <p class="zpay-muted">${t(1)} <b>${paymentLanguage==='hi'?({monthly:'1 महीना',quarterly:'3 महीने',halfyear:'6 महीने',yearly:'1 साल'}[planKey]):plan.label}</b> · ${t(2)} <b>₹${plan.amount}</b></p>
      <p class="zpay-muted">${t(3)}</p>
      <div class="zpay-qr-wrap"><canvas id="zpayQr" width="240" height="240" aria-label="ZENURA IGNITE UPI payment QR code"></canvas><span class="zpay-qr-caption">${t(4)} · ₹${plan.amount}</span></div>
      <p class="zpay-muted" style="text-align:center">No mobile number or UPI ID is printed on this screen. Your UPI app may show payee details after scanning.</p>
      <label class="label" for="zpayUtr">${t(5)}</label>
      <input class="zpay-input" id="zpayUtr" maxlength="40" autocomplete="off" placeholder="${t(6)}" value="${String(keepUtr).replace(/[&<>"]/g, '')}">
      <p class="zpay-muted">${t(7)}</p>
      <div class="zpay-actions"><button type="button" id="zpaySubmit">${t(8)}</button><button class="secondary" type="button" id="zpayCancel">${t(9)}</button></div>`;
    say(t(10));
    const qrCanvas = $('zpayQr');
    if (window.QRCode && qrCanvas) {
      QRCode.toCanvas(qrCanvas, upi, {width:240, margin:2, errorCorrectionLevel:'M', color:{dark:'#111827',light:'#ffffff'}}, error => {
        if (error) {
          console.error('UPI QR generation failed', error);
          const wrap = qrCanvas.closest('.zpay-qr-wrap');
          if (wrap) wrap.innerHTML = '<p class="zpay-qr-error">QR could not be generated. Please refresh and try again.</p>';
        }
      });
    } else {
      const wrap = qrCanvas?.closest('.zpay-qr-wrap');
      if (wrap) wrap.innerHTML = '<p class="zpay-qr-error">QR generator is unavailable. Please refresh and try again.</p>';
    }
    $('zpayCancel').onclick = close;
    $('zpaySubmit').onclick = async () => {
      const current = requireUser();
      const utr = $('zpayUtr').value.trim();
      if (!current) return;
      if (!/^[A-Za-z0-9-]{8,40}$/.test(utr)) return say('Enter a valid UTR / transaction ID (8–40 letters or digits).');
      $('zpaySubmit').disabled = true;
      say('Submitting payment request…');
      try {
        await db.collection('payments').add({
          uid:current.uid, email:current.email || '', planKey, planLabel:plan.label,
          amount:plan.amount, months:plan.months, utr,
          status:'pending', createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        say('Request submitted. Premium will activate only after admin approval.');
        $('premiumStatus').textContent = 'Your payment request is pending admin verification.';
        $('zpaySubmit').textContent = 'Submitted';
      } catch (err) {
        console.error('Payment request failed', err);
        say('Could not submit. Check that Firestore security rules have been published, then retry.');
        $('zpaySubmit').disabled = false;
      }
    };
    open();
  }

  document.querySelectorAll('[data-plan]').forEach(btn => {
    btn.addEventListener('click', () => openPayment(btn.getAttribute('data-plan')));
  });

  const drawer = $('drawer');
  if (drawer) {
    const adminBtn = document.createElement('button');
    adminBtn.id = 'zAdminOpen';
    adminBtn.textContent = '▣ Admin Payment Approvals';
    adminBtn.style.display = 'none';
    drawer.appendChild(adminBtn);
    adminBtn.onclick = () => { drawer.classList.remove('open'); const ds=$('drawerShade'); if(ds)ds.classList.remove('open'); openAdmin(); };
  }

  async function openAdmin() {
    const user = requireUser();
    if (!user) return;
    if ((user.email || '').toLowerCase() !== ADMIN_EMAIL) {
      say('Admin access denied.');
      return;
    }
    body.innerHTML = `<h2>Admin · Payment Approvals</h2><p class="zpay-muted">Verify each UTR against the actual Bank of Baroda / UPI account credit before approving. Screenshots alone are not proof.</p><button class="secondary" id="zAdminRefresh" type="button">Refresh requests</button><div class="zadmin-list" id="zAdminList">Loading…</div>`;
    say('Admin access verified for ' + ADMIN_EMAIL);
    open();
    $('zAdminRefresh').onclick = loadRequests;
    await loadRequests();
  }
  async function loadRequests() {
    const list = $('zAdminList');
    if (!list) return;
    list.textContent = 'Loading payment requests…';
    try {
      const snap = await db.collection('payments').where('status','==','pending').get();
      const docs = snap.docs.slice().sort((a,b) => {
        const at=a.data().createdAt?.toMillis?.()||0, bt=b.data().createdAt?.toMillis?.()||0; return bt-at;
      });
      list.innerHTML = '';
      if (!docs.length) { list.textContent = 'No pending payment requests.'; return; }
      docs.forEach(doc => {
        const p = doc.data();
        const card = document.createElement('article'); card.className='zadmin-card';
        const title = document.createElement('b'); title.textContent = (p.planLabel||'Plan') + ' · ₹' + (p.amount||'—');
        const meta = document.createElement('small');
        meta.textContent = 'Email: '+(p.email||'—')+' | UID: '+(p.uid||'—')+' | UTR: '+(p.utr||'—')+' | Request: '+doc.id;
        const row=document.createElement('div'); row.className='zadmin-row';
        const approve=document.createElement('button'); approve.type='button'; approve.textContent='Approve & activate';
        const reject=document.createElement('button'); reject.type='button'; reject.textContent='Reject'; reject.className='secondary';
        approve.onclick=()=>decide(doc.id,p,true,approve,reject);
        reject.onclick=()=>decide(doc.id,p,false,approve,reject);
        row.append(approve,reject); card.append(title,meta,row); list.append(card);
      });
    } catch (err) {
      console.error('Admin request load failed',err);
      list.textContent='Could not load requests. Publish the supplied Firestore rules and confirm you are signed in as the admin.';
    }
  }
  async function decide(id,p,approve,yes,no) {
    const user=auth.currentUser;
    if (!user || (user.email||'').toLowerCase()!==ADMIN_EMAIL) return say('Admin access denied.');
    if (approve && (!PLANS[p.planKey] || p.amount!==PLANS[p.planKey].amount || p.months!==PLANS[p.planKey].months)) return say('Plan details do not match the approved price list. Do not approve.');
    if (!confirm((approve?'Approve this payment and activate Premium?':'Reject this payment request?')+'\nUTR: '+(p.utr||'—'))) return;
    yes.disabled=true; no.disabled=true;
    try {
      const batch=db.batch();
      const paymentRef=db.collection('payments').doc(id);
      batch.update(paymentRef,{status:approve?'approved':'rejected',reviewedAt:firebase.firestore.FieldValue.serverTimestamp(),reviewedBy:user.email});
      if (approve) {
        const now=new Date(), expiry=new Date(now);
        expiry.setMonth(expiry.getMonth()+p.months);
        const entitlementRef=db.collection('users').doc(p.uid).collection('private').doc('entitlement');
        batch.set(entitlementRef,{active:true,planKey:p.planKey,planLabel:p.planLabel,amount:p.amount,startsAt:firebase.firestore.Timestamp.fromDate(now),validUntil:firebase.firestore.Timestamp.fromDate(expiry),paymentId:id,approvedBy:user.email,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      }
      await batch.commit();
      say(approve?'Approved. Premium entitlement activated.':'Request rejected.');
      await loadRequests();
    } catch(err) {
      console.error('Admin decision failed',err);
      say('Could not save decision. Confirm Firestore rules are published.');
      yes.disabled=false; no.disabled=false;
    }
  }

  auth.onAuthStateChanged(user => {
    const btn=$('zAdminOpen');
    if(btn) btn.style.display=user && (user.email||'').toLowerCase()===ADMIN_EMAIL?'block':'none';
    if (!user) return;
    db.collection('users').doc(user.uid).collection('private').doc('entitlement').get()
      .then(doc => {
        if (!doc.exists) return;
        const e=doc.data();
        const expiry=e.validUntil?.toDate?.();
        const active=!!e.active && expiry && expiry.getTime()>Date.now();
        if ($('premiumStatus')) $('premiumStatus').textContent=active
          ? 'Premium active: '+(e.planLabel||'Plan')+' until '+expiry.toLocaleDateString('en-IN')+'.'
          : 'No active Premium entitlement. Pending requests require admin approval.';
      }).catch(err=>console.warn('Entitlement read unavailable',err));
  });
})();
