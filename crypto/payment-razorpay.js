/* ZENURA IGNITE — Razorpay Checkout
 * Public checkout key is returned by the authenticated server function.
 * Secret keys and entitlement writes remain server-side only.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = $('premiumStatus');
  const plans = {
    monthly: 'month_1',
    quarterly: 'month_3',
    halfyear: 'month_6',
    yearly: 'year_1'
  };
  const say = message => { if (status) status.textContent = message; };
  let functions = null;
  function backend() {
    if (!window.firebase || !firebase.apps.length || !firebase.auth || !firebase.functions) {
      throw new Error('Firebase services are not loaded.');
    }
    if (!functions) functions = firebase.app().functions('asia-south1');
    return functions;
  }
  async function refreshAccess() {
    const user = firebase.auth().currentUser;
    if (!user) { say('Sign in to view your Premium access and purchase a plan.'); return; }
    try {
      const result = await backend().httpsCallable('getPremiumAccess')({});
      const data = result.data || {};
      if (data.status === 'premium' && data.premiumEndsAt) {
        say('Premium active until ' + new Date(data.premiumEndsAt).toLocaleDateString('en-IN') + '.');
      } else if (data.status === 'trial' && data.trialEndsAt) {
        say('Free demo active until ' + new Date(data.trialEndsAt).toLocaleDateString('en-IN') + '.');
      } else {
        say('Your demo has ended. Choose a one-time Premium plan to continue.');
      }
    } catch (error) {
      console.error('Premium access lookup failed', error);
      say('Could not verify Premium access. Please try again.');
    }
  }
  async function startCheckout(button, planId) {
    const user = firebase.auth().currentUser;
    if (!user) {
      say('Please sign in before purchasing a Premium plan.');
      const authShade = $('authShade');
      if (authShade) authShade.classList.add('open');
      return;
    }
    if (typeof window.Razorpay !== 'function') {
      say('Secure checkout could not load. Check your connection and retry.');
      return;
    }
    button.disabled = true;
    say('Creating a secure payment order…');
    try {
      const create = await backend().httpsCallable('createPremiumOrder')({planId});
      const order = create.data;
      if (!order || !order.orderId || !order.keyId || !Number.isInteger(order.amount)) {
        throw new Error('The payment server returned an invalid order.');
      }
      const options = {
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'ZENURA IGNITE',
        description: 'Premium · ' + order.planLabel,
        order_id: order.orderId,
        prefill: {email: user.email || ''},
        notes: {product: 'ZENURA_IGNITE_PREMIUM'},
        theme: {color: '#25d7b0'},
        modal: {ondismiss: () => { say('Checkout closed. No Premium access was activated.'); button.disabled = false; }},
        handler: async response => {
          say('Payment received by checkout. Verifying securely…');
          try {
            const verify = await backend().httpsCallable('verifyPremiumCheckout')({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature
            });
            if (!verify.data || verify.data.verified !== true) throw new Error('Payment signature verification failed.');
            say('Payment signature verified. Waiting for Razorpay payment confirmation to activate Premium…');
            await new Promise(resolve => setTimeout(resolve, 1800));
            await refreshAccess();
          } catch (error) {
            console.error('Checkout verification failed', error);
            say('Payment was submitted but could not yet be verified. Do not pay again; refresh Premium status or contact support.');
          } finally { button.disabled = false; }
        }
      };
      const checkout = new Razorpay(options);
      checkout.on('payment.failed', event => {
        console.error('Razorpay payment failed', event && event.error);
        say('Payment was not completed. You can retry securely.');
        button.disabled = false;
      });
      checkout.open();
    } catch (error) {
      console.error('Razorpay checkout could not start', error);
      const code = error && error.code;
      say(code === 'functions/unauthenticated'
        ? 'Your sign-in session expired. Sign in again.'
        : 'Secure checkout is not configured yet. The administrator must configure Razorpay secrets and deploy the payment functions.');
      button.disabled = false;
    }
  }
  document.querySelectorAll('[data-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const planId = plans[button.getAttribute('data-plan')];
      if (!planId) return;
      startCheckout(button, planId);
    });
  });
  document.addEventListener('zenura-auth-changed', () => refreshAccess());
  window.addEventListener('zenura-premium-refresh', () => refreshAccess());
  if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(() => refreshAccess());
  else window.addEventListener('load', refreshAccess);
})();
