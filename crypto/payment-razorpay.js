/* ZENURA IGNITE — QR-only UPI Premium checkout.
 * No phone number/UPI ID is printed in the UI. QR embeds the merchant UPI URI.
 * A UTR is never treated as proof: an admin must match it against actual bank credit.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ADMIN_EMAIL = 'sharerohit111@gmail.com';
  const PAYEE_UPI = '9756591106-4@axl';
  const PAYEE_NAME = 'ROHIT KUMAR';
  const PLANS = {
    monthly: {id:'month_1',label:'1 Month',amount:99,days:30},
    quarterly: {id:'month_3',label:'3 Months',amount:199,days:90},
    halfyear: {id:'month_6',label:'6 Months',amount:399,days:180},
    yearly: {id:'year_1',label:'1 Year',amount:799,days:365}
  };
  let db, auth, qrPromise;
  const status = $('premiumStatus');
  const say = message => { if (status) status.textContent = message; };
  function services() {
    if (!window.firebase || !firebase.apps.length || !firebase.auth || !firebase.firestore) throw new Error('Firebase is not ready.');
    auth = auth || firebase.auth();
    db = db || firebase.firestore();
    return {auth,db};
  }
  function loadQrLibrary() {
    if (window.QRCode) return Promise.resolve();
    if (qrPromise) return qrPromise;
    qrPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.async = true;
      script.onload = () => window.QRCode ? resolve() : reject(new Error('QR library did not initialize.'));
      script.onerror = () => reject(new Error('Could not load QR generator.'));
      document.head.appendChild(script);
    });
    return qrPromise;
  }
  function ensureModal() {
    if ($('ziQrShade')) return;
    const style = document.createElement('style');
    style.textContent = `
      #ziQrShade{position:fixed;inset:0;z-index:10050;background:#030914d9;display:none;align-items:center;justify-content:center;padding:14px}
      #ziQrShade.open{display:flex}#ziQrPanel{width:min(100%,430px);max-height:92dvh;overflow:auto;background:#0b1728;color:#eef5ff;border:1px solid #28435e;border-radius:20px;padding:20px;box-shadow:0 24px 80px #0009}
      #ziQrPanel h2{font-size:20px;margin:0 0 6px}#ziQrPanel .zi-muted{font-size:12px;line-height:1.5;color:#9eb2c9}
      #ziQrPanel .zi-price{font-size:34px;font-weight:850;text-align:center;margin:12px 0}
      #ziQrCanvas{background:#fff;padding:12px;border-radius:14px;display:grid;place-items:center;width:264px;height:264px;max-width:100%;margin:12px auto}
      #ziQrCanvas img{max-width:240px;max-height:240px}#ziQrCanvas canvas{max-width:240px;max-height:240px}
      #ziQrPanel input{box-sizing:border-box;width:100%;padding:13px;border-radius:10px;border:1px solid #36516d;background:#101f33;color:#fff;font-size:15px;margin:7px 0 12px}
      #ziQrPanel button{border:0;border-radius:11px;padding:13px 15px;font-weight:800;cursor:pointer}
      #ziQrSubmit,#ziQrAdminRefresh{width:100%;background:#24d6ae;color:#061b1a}
      #ziQrClose,#ziQrAdminBack{background:#20344b;color:#eaf2fc}
      #ziQrPanel button:disabled{opacity:.5;cursor:not-allowed}
      .zi-admin-card{border:1px solid #2d4965;border-radius:12px;padding:12px;margin:10px 0;font-size:12px}
      .zi-admin-card button{margin:8px 6px 0 0;background:#24d6ae;color:#06211b}
      .zi-admin-card button.zi-reject{background:#35465b;color:#fff}
    `;
    document.head.appendChild(style);
    const shade = document.createElement('div');
    shade.id = 'ziQrShade';
    shade.innerHTML = `<section id="ziQrPanel" role="dialog" aria-modal="true" aria-label="ZENURA QR payment">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>ZENURA IGNITE</h2><button id="ziQrClose" type="button">✕</button></div>
      <p class="zi-muted" id="ziQrIntro">Scan the QR using any UPI app. Payee details are shown by your UPI app after scanning.</p>
      <div class="zi-price" id="ziQrPrice"></div><div id="ziQrCanvas" aria-label="UPI payment QR code"></div>
      <p class="zi-muted" style="text-align:center">QR payment only · No phone number or UPI ID is printed on this page. Your UPI app may display payee details from the QR.</p>
      <label for="ziQrUtr" style="font-size:13px;font-weight:750">UPI Transaction ID / UTR</label>
      <input id="ziQrUtr" inputmode="text" autocomplete="off" maxlength="40" placeholder="Enter UTR after successful payment">
      <button id="ziQrSubmit" type="button">I HAVE PAID — SUBMIT UTR</button>
      <p class="zi-muted" id="ziQrMessage" aria-live="polite"></p>
      <div id="ziQrAdmin" hidden></div>
    </section>`;
    document.body.appendChild(shade);
    $('ziQrClose').onclick = close;
    shade.addEventListener('click',e=>{if(e.target===shade)close();});
  }
  function open() { ensureModal(); $('ziQrShade').classList.add('open'); }
  function close() { const shade=$('ziQrShade'); if(shade)shade.classList.remove('open'); }
  function upiUri(plan) {
    const params = new URLSearchParams({
      pa:PAYEE_UPI,pn:PAYEE_NAME,am:plan.amount.toFixed(2),cu:'INR',
      tn:'ZENURA IGNITE Premium - '+plan.label
    });
    return 'upi://pay?'+params.toString();
  }
  async function openPlan(key) {
    const plan=PLANS[key]; if(!plan)return;
    ensureModal();
    const user=auth.currentUser;
    if(!user){say('Please sign in before purchasing.');const shade=$('authShade');if(shade)shade.classList.add('open');return;}
    open();
    $('ziQrPrice').textContent='₹'+plan.amount+' · '+plan.label;
    $('ziQrMessage').textContent='Preparing your secure payment QR…';
    $('ziQrUtr').value=''; $('ziQrSubmit').disabled=true;
    $('ziQrCanvas').innerHTML='';
    try {
      await loadQrLibrary();
      new QRCode($('ziQrCanvas'),{text:upiUri(plan),width:240,height:240,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
      $('ziQrMessage').textContent='After paying, enter the UTR shown in your UPI app. Premium activates only after the payment is checked against the merchant bank account.';
      $('ziQrSubmit').disabled=false;
    } catch(error) {
      console.error('QR creation failed',error);
      $('ziQrMessage').textContent='QR could not be loaded. Check your internet connection and retry.';
    }
    $('ziQrSubmit').onclick=()=>submitUtr(key,plan);
  }
  async function submitUtr(key,plan) {
    const user=auth.currentUser, utr=$('ziQrUtr').value.trim();
    if(!user)return $('ziQrMessage').textContent='Please sign in again.';
    if(!/^[A-Za-z0-9-]{8,40}$/.test(utr))return $('ziQrMessage').textContent='Enter a valid UTR / transaction ID (8–40 letters or digits).';
    $('ziQrSubmit').disabled=true;
    $('ziQrMessage').textContent='Submitting payment reference…';
    try {
      const duplicate=await db.collection('payments').where('uid','==',user.uid).where('utr','==',utr).limit(1).get();
      if(!duplicate.empty)throw new Error('This UTR has already been submitted. Contact support if this is your own earlier request.');
      await db.collection('payments').add({
        uid:user.uid,email:user.email||'',planId:plan.id,planLabel:plan.label,
        amount:plan.amount,days:plan.days,utr,status:'pending',
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      $('ziQrMessage').textContent='Payment reference submitted. Your Premium access will activate after the administrator verifies the actual bank credit. Please do not pay again.';
      $('ziQrSubmit').textContent='SUBMITTED';
      say('UPI payment request submitted — awaiting manual bank verification.');
    } catch(error) {
      console.error('UPI payment submission failed',error);
      $('ziQrMessage').textContent=error.message||'Could not submit. Please retry later.';
      $('ziQrSubmit').disabled=false;
    }
  }
  function addAdminButton() {
    const drawer=$('drawer');
    if(!drawer||$('ziQrAdminButton'))return;
    const button=document.createElement('button');
    button.id='ziQrAdminButton';button.type='button';button.textContent='▣ Admin UPI Approvals';button.style.display='none';
    drawer.appendChild(button);
    button.onclick=()=>{drawer.classList.remove('open');const shade=$('drawerShade');if(shade)shade.classList.remove('open');openAdmin();};
    auth.onAuthStateChanged(user=>{button.style.display=user&&(user.email||'').toLowerCase()===ADMIN_EMAIL?'block':'none';});
  }
  async function openAdmin() {
    const user=auth.currentUser;
    if(!user||(user.email||'').toLowerCase()!==ADMIN_EMAIL)return say('Admin access denied.');
    ensureModal();open();
    $('ziQrPrice').textContent='ADMIN · UPI PAYMENT APPROVALS';
    $('ziQrCanvas').innerHTML='';
    $('ziQrUtr').hidden=true;$('ziQrUtr').previousElementSibling.hidden=true;$('ziQrSubmit').hidden=true;
    $('ziQrIntro').textContent='Approve only after matching the UTR and exact amount against the actual bank / UPI account credit. A screenshot or UTR alone is not proof.';
    const admin=$('ziQrAdmin');admin.hidden=false;admin.innerHTML='<button id="ziQrAdminRefresh" type="button">REFRESH REQUESTS</button><div id="ziQrAdminList" class="zi-muted">Loading…</div>';
    $('ziQrClose').onclick=()=>{close();$('ziQrUtr').hidden=false;$('ziQrUtr').previousElementSibling.hidden=false;$('ziQrSubmit').hidden=false;};
    $('ziQrAdminRefresh').onclick=loadAdminRequests;
    await loadAdminRequests();
  }
  async function loadAdminRequests() {
    const list=$('ziQrAdminList');if(!list)return;list.textContent='Loading…';
    try {
      const snap=await db.collection('payments').where('status','==','pending').limit(50).get();
      list.innerHTML='';
      if(snap.empty){list.textContent='No pending payment requests.';return;}
      snap.docs.forEach(doc=>{
        const p=doc.data(),card=document.createElement('article');card.className='zi-admin-card';
        const detail=document.createElement('div');
        detail.textContent=(p.planLabel||'Plan')+' · ₹'+p.amount+' | '+(p.email||'—')+' | UTR: '+(p.utr||'—');
        const yes=document.createElement('button');yes.type='button';yes.textContent='VERIFY BANK CREDIT & APPROVE';
        const no=document.createElement('button');no.type='button';no.className='zi-reject';no.textContent='REJECT';
        yes.onclick=()=>reviewPayment(doc.id,p,true,yes,no);no.onclick=()=>reviewPayment(doc.id,p,false,yes,no);
        card.append(detail,yes,no);list.append(card);
      });
    } catch(error){console.error(error);list.textContent='Could not load requests. Publish the updated Firestore rules and sign in as the verified admin.';}
  }
  async function reviewPayment(id,p,approve,yes,no) {
    if(!auth.currentUser||(auth.currentUser.email||'').toLowerCase()!==ADMIN_EMAIL)return say('Admin access denied.');
    const expected=Object.values(PLANS).find(x=>x.id===p.planId);
    if(approve&&(!expected||expected.amount!==p.amount||expected.days!==p.days))return say('Plan/amount mismatch. Do not approve.');
    if(approve&&!window.confirm('Have you verified this UTR and exact amount in the actual bank account?\n\nUTR: '+p.utr+'\nAmount: ₹'+p.amount))return;
    yes.disabled=true;no.disabled=true;
    try {
      const paymentRef=db.collection('payments').doc(id), entitlementRef=db.collection('entitlements').doc(p.uid);
      const batch=db.batch();
      if(approve){
        const existing=await entitlementRef.get(),old=existing.exists?existing.data():{};
        const now=new Date(),oldEnd=old.currentPeriodEnd&&old.currentPeriodEnd.toDate?old.currentPeriodEnd.toDate():null;
        const start=oldEnd&&oldEnd.getTime()>now.getTime()?oldEnd:now;
        const end=new Date(start.getTime()+p.days*86400000);
        batch.set(entitlementRef,{uid:p.uid,status:'premium',planId:p.planId,currentPeriodStart:old.currentPeriodStart||firebase.firestore.Timestamp.fromDate(now),currentPeriodEnd:firebase.firestore.Timestamp.fromDate(end),autoRenew:false,provider:'upi_qr_manual',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      }
      batch.update(paymentRef,{status:approve?'approved':'rejected',reviewedAt:firebase.firestore.FieldValue.serverTimestamp(),reviewedBy:auth.currentUser.email});
      await batch.commit();
      say(approve?'Payment verified and Premium activated.':'Payment request rejected.');
      await loadAdminRequests();
    } catch(error){console.error(error);say('Could not save review. Ensure updated Firestore rules are published.');yes.disabled=false;no.disabled=false;}
  }
  function init() {
    try {services();} catch(error){console.warn(error);return;}
    document.querySelectorAll('[data-plan]').forEach(button=>{
      button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openPlan(button.getAttribute('data-plan'));},true);
    });
    addAdminButton();
    auth.onAuthStateChanged(async user=>{
      if(!user){say('Sign in to view Premium access and purchase a plan.');return;}
      try{
        const result=await firebase.app().functions('asia-south1').httpsCallable('getPremiumAccess')({});
        const data=result.data||{};
        if(data.status==='premium'&&data.premiumEndsAt)say('Premium active until '+new Date(data.premiumEndsAt).toLocaleDateString('en-IN')+'.');
        else if(data.status==='trial'&&data.trialEndsAt)say('Free demo active until '+new Date(data.trialEndsAt).toLocaleDateString('en-IN')+'.');
        else say('Your demo has ended. Choose a Premium plan to continue.');
      }catch(error){console.warn('Premium status refresh failed',error);}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();