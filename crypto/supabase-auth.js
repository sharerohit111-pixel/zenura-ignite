import { supabase } from "./supabase-client.js";

const byId = id => document.getElementById(id);
const authShade = byId("authShade");
if (authShade) {
  const modal = authShade.querySelector(".auth-modal");
  if (modal) {
    modal.innerHTML = `
      <div class="head"><h2>ZENURA Account</h2><button class="reset" id="zenuraAuthClose" type="button">✕</button></div>
      <p class="footnote" id="zenuraAuthMessage">Sign in to your ZENURA Supabase account.</p>
      <label class="label" for="zenuraEmail">Email address</label>
      <input class="field" id="zenuraEmail" type="email" autocomplete="email" placeholder="you@example.com">
      <label class="label" for="zenuraPassword">Password</label>
      <input class="field" id="zenuraPassword" type="password" autocomplete="current-password" placeholder="Your password">
      <button class="submit" id="zenuraEmailAction" type="button">Sign in with email</button>
      <button class="googleBtn" id="zenuraGoogleAction" type="button">Continue with Google</button>
      <button class="googleBtn" id="zenuraCreateAction" type="button">Create an account</button>
      <p class="footnote">New accounts use Supabase Authentication. Guest trades remain separate on this device. Cloud trade synchronization is being connected separately.</p>
    `;

    const message = value => { byId("zenuraAuthMessage").textContent = value; };
    const credentials = () => ({
      email: byId("zenuraEmail").value.trim(),
      password: byId("zenuraPassword").value
    });
    const busy = value => ["zenuraEmailAction","zenuraGoogleAction","zenuraCreateAction"].forEach(id => {
      const el = byId(id); if (el) el.disabled = value;
    });
    const friendly = error => {
      const code = error?.code || "";
      const map = {
        "invalid_credentials":"Email or password is incorrect.",
        "email_not_confirmed":"Verify your email before signing in.",
        "user_already_exists":"This email already has an account. Sign in instead.",
        "weak_password":"Choose a stronger password.",
        "over_email_send_rate_limit":"Too many email requests. Wait and try again.",
        "popup_closed":"Google sign-in was closed."
      };
      return map[code] || error?.message || "Could not complete authentication. Try again.";
    };
    const openModal = () => {
      byId("drawer")?.classList.remove("open");
      byId("drawerShade")?.classList.remove("open");
      authShade.classList.add("open");
      message("Sign in or create your ZENURA account.");
    };

    byId("zenuraAuthClose").onclick = () => authShade.classList.remove("open");
    byId("closeAuth")?.addEventListener("click", () => authShade.classList.remove("open"));
    byId("zenuraEmailAction").onclick = async () => {
      const {email,password} = credentials();
      if (!email || !password) return message("Enter both your email and password.");
      busy(true); message("Signing in securely…");
      try {
        const {error} = await supabase.auth.signInWithPassword({email,password});
        if (error) throw error;
        authShade.classList.remove("open");
      } catch (error) { message(friendly(error)); }
      finally { busy(false); }
    };
    byId("zenuraCreateAction").onclick = async () => {
      const {email,password} = credentials();
      if (!email || !password) return message("Enter an email and password to create your account.");
      if (password.length < 8) return message("Use a password with at least 8 characters.");
      busy(true); message("Creating your secure account…");
      try {
        const {data,error} = await supabase.auth.signUp({
          email,password,
          options:{emailRedirectTo:window.location.origin+window.location.pathname}
        });
        if (error) throw error;
        if (!data.session) message("Account created. Check your email to verify it, then sign in.");
        else authShade.classList.remove("open");
      } catch (error) { message(friendly(error)); }
      finally { busy(false); }
    };
    byId("zenuraGoogleAction").onclick = async () => {
      busy(true); message("Redirecting to Google sign-in…");
      try {
        const {error} = await supabase.auth.signInWithOAuth({
          provider:"google",
          options:{redirectTo:window.location.origin+window.location.pathname,queryParams:{prompt:"select_account"}}
        });
        if (error) throw error;
      } catch (error) { message(friendly(error)); busy(false); }
    };

    byId("signInBtn")?.addEventListener("click",openModal);
    byId("drawerProfile")?.addEventListener("click",openModal);
    byId("profileBtn")?.addEventListener("click",openModal);
    byId("signOutBtn")?.addEventListener("click",async()=>{
      const {data:{session}}=await supabase.auth.getSession();
      if (!session) { message("No Supabase account is currently signed in."); return; }
      const {error}=await supabase.auth.signOut();
      if(error) message(friendly(error));
    });

    let lastUserId = null;
    let currentUserId = null;
    let authReady = false;
    window.ZENURA_CRYPTO_CLOUD = { isReady: () => authReady, isSignedIn: () => Boolean(currentUserId), getSession: () => supabase.auth.getSession() };
    const publish = user => {
      const id = user?.id || null;
      if (authReady && id === lastUserId) return;
      lastUserId = id;
      currentUserId = id;
      authReady = true;
      const email = user?.email || null;
      byId("profileName") && (byId("profileName").textContent = user?.user_metadata?.full_name || email || "Guest User");
      byId("profileEmail") && (byId("profileEmail").textContent = email || "Sign in to connect your account");
      const state = document.querySelector(".account-state");
      if (state) state.textContent = user ? "Supabase account · " + email : "Guest paper account · saved on this device";
      const signOut = byId("signOutBtn");
      if (signOut) signOut.textContent = user ? "Sign out" : "Not signed in";
      window.dispatchEvent(new CustomEvent("zenura-auth-changed",{detail:{uid:id,email}}));
    };

    supabase.auth.onAuthStateChange((_event,session)=>publish(session?.user||null));
    supabase.auth.getSession().then(({data,error})=>{
      if(error) message("Could not restore your Supabase session. Please sign in again.");
      publish(data?.session?.user||null);
    });
  }
}
