/* ZENURA IGNITE Firebase Authentication.
 * Isolated from the paper-trading engine. This module authenticates users only;
 * it does not sync local portfolios or grant Premium entitlements.
 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const authShade = byId('authShade');
  if (!authShade || !window.firebase || !window.ZENURA_FIREBASE_CONFIG) return;

  let auth;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.ZENURA_FIREBASE_CONFIG);
    auth = firebase.auth();
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    return;
  }

  const modal = authShade.querySelector('.auth-modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="head"><h2>ZENURA Account</h2><button class="reset" id="zenuraAuthClose" type="button">✕</button></div>
    <p class="footnote" id="zenuraAuthMessage">Sign in to use your account across supported features.</p>
    <label class="label" for="zenuraEmail">Email address</label>
    <input class="field" id="zenuraEmail" type="email" autocomplete="email" placeholder="you@example.com">
    <label class="label" for="zenuraPassword">Password</label>
    <input class="field" id="zenuraPassword" type="password" autocomplete="current-password" placeholder="At least 6 characters">
    <button class="submit" id="zenuraEmailAction" type="button">Sign in with email</button>
    <button class="googleBtn" id="zenuraGoogleAction" type="button">Continue with Google</button>
    <button class="googleBtn" id="zenuraCreateAction" type="button">Create an account</button>
    <p class="footnote">Your paper-trading portfolio remains stored locally on this device. Premium access is not activated by signing in.</p>
  `;

  const message = text => { byId('zenuraAuthMessage').textContent = text; };
  const friendly = error => {
    const map = {
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/user-not-found': 'No account found. Choose Create an account first.',
      'auth/wrong-password': 'Incorrect password. Try again.',
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
      'auth/weak-password': 'Choose a password with at least 6 characters.',
      'auth/popup-closed-by-user': 'Google sign-in was closed before completion.',
      'auth/popup-blocked': 'Allow pop-ups for this site, then try Google sign-in again.',
      'auth/unauthorized-domain': 'Add sharerohit111-pixel.github.io to Firebase Authorized domains.',
      'auth/network-request-failed': 'Network error. Check your internet connection.'
    };
    return map[error.code] || 'Could not complete sign-in. Please try again.';
  };
  const credentials = () => ({
    email: byId('zenuraEmail').value.trim(),
    password: byId('zenuraPassword').value
  });
  const busy = value => {
    ['zenuraEmailAction','zenuraGoogleAction','zenuraCreateAction'].forEach(id => {
      const el = byId(id); if (el) el.disabled = value;
    });
  };

  byId('zenuraAuthClose').onclick = () => authShade.classList.remove('open');
  byId('zenuraEmailAction').onclick = async () => {
    const {email,password} = credentials();
    if (!email || !password) return message('Enter both your email and password.');
    busy(true); message('Signing in…');
    try {
      await auth.signInWithEmailAndPassword(email,password);
      authShade.classList.remove('open');
    } catch (error) { message(friendly(error)); }
    finally { busy(false); }
  };
  byId('zenuraCreateAction').onclick = async () => {
    const {email,password} = credentials();
    if (!email || !password) return message('Enter an email and password to create your account.');
    if (password.length < 6) return message('Choose a password with at least 6 characters.');
    busy(true); message('Creating your account…');
    try {
      await auth.createUserWithEmailAndPassword(email,password);
      authShade.classList.remove('open');
    } catch (error) { message(friendly(error)); }
    finally { busy(false); }
  };
  byId('zenuraGoogleAction').onclick = async () => {
    busy(true); message('Opening Google sign-in…');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({prompt:'select_account'});
      await auth.signInWithPopup(provider);
      authShade.classList.remove('open');
    } catch (error) { message(friendly(error)); }
    finally { busy(false); }
  };

  const openModal = () => { const drawer = byId('drawer'), shade = byId('drawerShade'); if (drawer) drawer.classList.remove('open'); if (shade) shade.classList.remove('open'); authShade.classList.add('open'); message('Sign in or create your ZENURA account.'); };
  const signIn = byId('signInBtn');
  const profile = byId('drawerProfile');
  const profileBtn = byId('profileBtn');
  if (signIn) signIn.onclick = openModal;
  if (profile) profile.onclick = openModal;
  if (profileBtn) profileBtn.onclick = () => {
    if (auth.currentUser) openModal();
    else {
      const drawer = byId('drawer'), shade = byId('drawerShade');
      if (drawer) drawer.classList.remove('open');
      if (shade) shade.classList.remove('open');
      openModal();
    }
  };
  const close = byId('closeAuth');
  if (close) close.onclick = () => authShade.classList.remove('open');
  const signOut = byId('signOutBtn');
  if (signOut) signOut.onclick = async () => {
    if (!auth.currentUser) return message('No cloud account is currently signed in.');
    try { await auth.signOut(); } catch (error) { console.error(error); }
  };

  auth.onAuthStateChanged(user => {
    const name = user ? (user.displayName || user.email || 'Signed-in user') : 'Guest User';
    const email = user ? (user.email || 'Google account') : 'Sign in to connect your account';
    if (byId('profileName')) byId('profileName').textContent = name;
    if (byId('profileEmail')) byId('profileEmail').textContent = email;
    const state = document.querySelector('.account-state');
    if (state) state.textContent = user ? 'Signed in · ' + email : 'Guest paper account · saved on this device';
    if (signOut) signOut.textContent = user ? 'Sign out' : 'Not signed in';
  });
})();
