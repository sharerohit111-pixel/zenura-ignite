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
  let db, auth, qrPromise, activePlan = null, adminMode = false;
  let paymentLanguage = localStorage.getItem('ziPaymentLanguage') === 'hi' ? 'hi' : 'en';
  const tr = (en, hi) => paymentLanguage === 'hi' ? hi : en;
  const PAYMENT_TEXT = {
    intro:['Scan the QR using any UPI app. Payee details are shown by your UPI app after scanning.','किसी भी UPI ऐप से QR स्कैन करें। भुगतान पाने वाले की जानकारी आपका UPI ऐप स्कैन करने के बाद दिखाएगा।'],
    qrNote:['QR payment only · No phone number or UPI ID is printed on this page. Your UPI app may display payee details from the QR.','केवल QR से भुगतान · इस पेज पर मोबाइल नंबर या UPI ID नहीं दिखाई जाती। QR स्कैन करने पर आपका UPI ऐप भुगतान पाने वाले की जानकारी दिखा सकता है।'],
    utrLabel:['UPI Transaction ID / UTR','UPI ट्रांज़ैक्शन ID / UTR'],
    utrPlaceholder:['Enter UTR after successful payment','सफल भुगतान के बाद UTR दर्ज करें'],
    submit:['I HAVE PAID — SUBMIT UTR','मैंने भुगतान कर दिया — UTR जमा करें'],
    adminIntro:['Approve only after matching the UTR and exact amount against the actual bank / UPI account credit. A screenshot or UTR alone is not proof.','UTR और सही राशि को बैंक / UPI खाते में प्राप्त वास्तविक भुगतान से मिलाने के बाद ही मंज़ूर करें। केवल स्क्रीनशॉट या UTR भुगतान का प्रमाण नहीं है।'],
    adminRefresh:['REFRESH REQUESTS','रिक्वेस्ट रीफ्रेश करें'],
    adminApprove:['VERIFY BANK CREDIT & APPROVE','बैंक भुगतान जाँचें और मंज़ूर करें'],
    adminReject:['REJECT','अस्वीकार करें'],
    preparing:['Preparing your secure payment QR…','आपका सुरक्षित पेमेंट QR तैयार हो रहा है…'],
    afterPay:['After paying, enter the UTR shown in your UPI app. Premium activates only after the payment is checked against the merchant bank account.','भुगतान के बाद अपने UPI ऐप में दिखने वाला UTR दर्ज करें। मर्चेंट बैंक खाते में भुगतान की पुष्टि होने के बाद ही Premium सक्रिय होगा।'],
    qrError:['QR could not be loaded. Check your internet connection and retry.','QR लोड नहीं हो पाया। इंटरनेट कनेक्शन जाँचकर दोबारा कोशिश करें।'],
    submitted:['Payment reference submitted. Your Premium access will activate after the administrator verifies the actual bank credit. Please do not pay again.','भुगतान विवरण जमा हो गया है। एडमिन द्वारा बैंक में वास्तविक भुगतान की पुष्टि के बाद Premium सक्रिय होगा। कृपया दोबारा भुगतान न करें।'],
    submitting:['Submitting payment reference…','भुगतान विवरण जमा किया जा रहा है…'],
    invalidUtr:['Enter a valid UTR / transaction ID (8–40 letters or digits).','सही UTR / ट्रांज़ैक्शन ID दर्ज करें (8–40 अक्षर या अंक)।'],
    signInAgain:['Please sign in again.','कृपया दोबारा लॉगिन करें।'],
    duplicate:['This UTR has already been submitted. Contact support if this is your own earlier request.','यह UTR पहले ही जमा किया जा चुका है। यदि यह आपकी पिछली रिक्वेस्ट है तो सपोर्ट से संपर्क करें।'],
    submittedStatus:['UPI payment request submitted — awaiting manual bank verification.','UPI भुगतान रिक्वेस्ट जमा है — बैंक से मैन्युअल पुष्टि बाकी है।'],
    noPending:['No pending payment requests.','कोई लंबित भुगतान रिक्वेस्ट नहीं है।'],
    loading:['Loading…','लोड हो रहा है…'],
    loadError:['Could not load requests. Publish the updated Firestore rules and sign in as the verified admin.','रिक्वेस्ट लोड नहीं हो सकीं। अपडेटेड Firestore Rules पब्लिश करें और सत्यापित एडमिन से लॉगिन करें।']
  };
  const paymentText = key => tr(PAYMENT_TEXT[key][0], PAYMENT_TEXT[key][1]);
  function applyPaymentLanguage() {
    const set=(id,key)=>{const el=$(id);if(el)el.textContent=paymentText(key);};
    set('ziQrIntro',adminMode?'adminIntro':'intro');set('ziQrNote','qrNote');set('ziQrUtrLabel','utrLabel');
    const input=$('ziQrUtr');if(input)input.placeholder=paymentText('utrPlaceholder');
    const submit=$('ziQrSubmit');if(submit&&!submit.hidden)submit.textContent=paymentText('submit');
    const toggle=$('ziQrLanguage');if(toggle){toggle.textContent=paymentLanguage==='en'?'हिंदी':'English';toggle.setAttribute('aria-label',paymentLanguage==='en'?'Switch to Hindi':'Switch to English');}
    const adminIntro=$('ziQrAdminIntro');if(adminIntro)adminIntro.textContent=paymentText('adminIntro');
    const refresh=$('ziQrAdminRefresh');if(refresh)refresh.textContent=paymentText('adminRefresh');
    document.querySelectorAll('[data-zi-admin-approve]').forEach(el=>el.textContent=paymentText('adminApprove'));
    document.querySelectorAll('[data-zi-admin-reject]').forEach(el=>el.textContent=paymentText('adminReject'));
    if(activePlan)$('ziQrPrice').textContent='₹'+activePlan.amount+' · '+tr(activePlan.label,({'1 Month':'1 महीना','3 Months':'3 महीने','6 Months':'6 महीने','1 Year':'1 साल'})[activePlan.label]);
  }
  function togglePaymentLanguage() {
    paymentLanguage=paymentLanguage==='en'?'hi':'en';
    try{localStorage.setItem('ziPaymentLanguage',paymentLanguage);}catch(_){}
    applyPaymentLanguage();
  }
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
      #ziQrPanel h2{font-size:20px;margin:0 0 6px}#ziQrLanguage{background:#20344b;color:#eaf2fc;padding:9px 12px!important;font-size:12px}#ziQrPanel .zi-muted{font-size:12px;line-height:1.5;color:#9eb2c9}
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
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>ZENURA IGNITE</h2><div style="display:flex;align-items:center;gap:7px"><button id="ziQrLanguage" type="button" aria-label="Switch language">हिंदी</button><button id="ziQrClose" type="button">✕</button></div></div>
      <p class="zi-muted" id="ziQrIntro">Scan the QR using any UPI app. Payee details are shown by your UPI app after scanning.</p>
      <div class="zi-price" id="ziQrPrice"></div><div id="ziQrCanvas" aria-label="UPI payment QR code"></div>
      <p class="zi-muted" id="ziQrNote" style="text-align:center">QR payment only · No phone number or UPI ID is printed on this page. Your UPI app may display payee details from the QR.</p>
      <label id="ziQrUtrLabel" for="ziQrUtr" style="font-size:13px;font-weight:750">UPI Transaction ID / UTR</label>
      <input id="ziQrUtr" inputmode="text" autocomplete="off" maxlength="40" placeholder="Enter UTR after successful payment">
      <button id="ziQrSubmit" type="button">I HAVE PAID — SUBMIT UTR</button>
      <p class="zi-muted" id="ziQrMessage" aria-live="polite"></p>
      <div id="ziQrAdmin" hidden></div>
    </section>`;
    document.body.appendChild(shade);
    $('ziQrClose').onclick = close;
    $('ziQrLanguage').onclick = togglePaymentLanguage;
    applyPaymentLanguage();
    shade.addEventListener('click',e=>{if(e.target===shade)close();});
  }
  function open() { ensureModal(); $('ziQrShade').classList.add('open'); }
  function close() { const shade=$('ziQrShade'); if(shade)shade.classList.remove('open'); if($('ziQrUtr')){$('ziQrUtr').hidden=false;$('ziQrUtr').previousElementSibling.hidden=false;} if($('ziQrSubmit'))$('ziQrSubmit').hidden=false; if($('ziQrAdmin'))$('ziQrAdmin').hidden=true; }
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
    $('ziQrAdmin').hidden=true;$('ziQrUtr').hidden=false;$('ziQrUtr').previousElementSibling.hidden=false;$('ziQrSubmit').hidden=false;$('ziQrSubmit').textContent='I HAVE PAID — SUBMIT UTR';
    adminMode=false;activePlan=plan;applyPaymentLanguage();
    $('ziQrMessage').textContent=paymentText('preparing');
    $('ziQrUtr').value=''; $('ziQrSubmit').disabled=true;
    $('ziQrCanvas').innerHTML='';
    try {
      await loadQrLibrary();
      new QRCode($('ziQrCanvas'),{text:upiUri(plan),width:240,height:240,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
      $('ziQrMessage').textContent=paymentText('afterPay');
      $('ziQrSubmit').disabled=false;
    } catch(error) {
      console.error('QR creation failed',error);
      $('ziQrMessage').textContent=paymentText('qrError');
    }
    $('ziQrSubmit').onclick=()=>submitUtr(key,plan);
  }
  async function submitUtr(key,plan) {
    const user=auth.currentUser, utr=$('ziQrUtr').value.trim();
    if(!user)return $('ziQrMessage').textContent=paymentText('signInAgain');
    if(!/^[A-Za-z0-9-]{8,40}$/.test(utr))return $('ziQrMessage').textContent=paymentText('invalidUtr');
    $('ziQrSubmit').disabled=true;
    $('ziQrMessage').textContent=paymentText('submitting');
    try {
      const ownRequests=await db.collection('payments').where('uid','==',user.uid).get();
      if(ownRequests.docs.some(doc=>(doc.data().utr||'').toLowerCase()===utr.toLowerCase()))throw new Error(paymentText('duplicate'));
      await db.collection('payments').add({
        uid:user.uid,email:user.email||'',planId:plan.id,planLabel:plan.label,
        amount:plan.amount,days:plan.days,utr,status:'pending',
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      $('ziQrMessage').textContent=paymentText('submitted');
      $('ziQrSubmit').textContent='SUBMITTED';
      say(paymentText('submittedStatus'));
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
    ensureModal();open();adminMode=true;activePlan=null;applyPaymentLanguage();
    $('ziQrPrice').textContent=tr('ADMIN · UPI PAYMENT APPROVALS','एडमिन · UPI भुगतान मंज़ूरी');
    $('ziQrCanvas').innerHTML='';
    $('ziQrUtr').hidden=true;$('ziQrUtr').previousElementSibling.hidden=true;$('ziQrSubmit').hidden=true;
    $('ziQrIntro').textContent=paymentText('adminIntro');
    const admin=$('ziQrAdmin');admin.hidden=false;admin.innerHTML='<button id="ziQrAdminRefresh" type="button">REFRESH REQUESTS</button><div id="ziQrAdminList" class="zi-muted">Loading…</div>';applyPaymentLanguage();
    $('ziQrClose').onclick=close;
    $('ziQrAdminRefresh').onclick=loadAdminRequests;
    await loadAdminRequests();
  }
  async function loadAdminRequests() {
    const list=$('ziQrAdminList');if(!list)return;list.textContent=paymentText('loading');
    try {
      const snap=await db.collection('payments').where('status','==','pending').limit(50).get();
      list.innerHTML='';
      if(snap.empty){list.textContent=paymentText('noPending');return;}
      snap.docs.forEach(doc=>{
        const p=doc.data(),card=document.createElement('article');card.className='zi-admin-card';
        const detail=document.createElement('div');
        detail.textContent=(p.planLabel||'Plan')+' · ₹'+p.amount+' | '+(p.email||'—')+' | UTR: '+(p.utr||'—');
        const yes=document.createElement('button');yes.type='button';yes.dataset.ziAdminApprove='1';yes.textContent=paymentText('adminApprove');
        const no=document.createElement('button');no.type='button';no.className='zi-reject';no.dataset.ziAdminReject='1';no.textContent=paymentText('adminReject');
        yes.onclick=()=>reviewPayment(doc.id,p,true,yes,no);no.onclick=()=>reviewPayment(doc.id,p,false,yes,no);
        card.append(detail,yes,no);list.append(card);
      });
    } catch(error){console.error(error);list.textContent=paymentText('loadError');}
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
        batch.set(entitlementRef,{uid:p.uid,status:'premium',planId:p.planId,currentPeriodStart:firebase.firestore.Timestamp.fromDate(start),currentPeriodEnd:firebase.firestore.Timestamp.fromDate(end),autoRenew:false,provider:'upi_qr_manual',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
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