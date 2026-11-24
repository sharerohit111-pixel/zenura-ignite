/* Native Supabase email/password authentication for ZENURA IGNITE. */
import { supabase } from "./supabase-client.js";

const card = document.getElementById("connection");
const connectButton = document.getElementById("upstox-connect");
if (card && connectButton) {
  const style = document.createElement("style");
  style.textContent = `
    .email-auth{flex:1 0 100%;display:grid;gap:7px;padding-top:8px;border-top:1px solid #36536a}
    .email-auth[hidden]{display:none}
    .email-auth input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #36536a;border-radius:7px;background:#091624;color:#eaf3fa;font:inherit;font-size:11px}
    .email-auth-actions{display:flex;gap:7px;flex-wrap:wrap}
    .email-auth button{border:1px solid #287e70;background:#123c37;color:#70e8c8;border-radius:7px;padding:8px 10px;font-size:8px;font-weight:900;cursor:pointer}
    .email-auth button[type=submit]{background:#35dfb7;color:#03251d}
    .email-auth button:disabled{opacity:.5;cursor:wait}
    .email-auth small{color:#a7bfd1;font-size:9px;line-height:1.5}
  `;
  document.head.append(style);
  const form = document.createElement("form");
  form.className = "email-auth";
  form.innerHTML = `
    <small id="email-auth-message">Create a new Supabase account or sign in. Firebase is not used for this app.</small>
    <input id="market-email" type="email" autocomplete="username" placeholder="Email address" required maxlength="254">
    <input id="market-password" type="password" autocomplete="current-password" placeholder="Password (minimum 8 characters)" required minlength="8" maxlength="128">
    <div class="email-auth-actions">
      <button type="submit" id="email-sign-in">SIGN IN</button>
      <button type="button" id="email-create">CREATE ACCOUNT</button>
      <button type="button" id="email-google">CONTINUE WITH GOOGLE</button>
      <button type="button" id="email-reset">RESET PASSWORD</button>
      <button type="button" id="email-sign-out" hidden>SIGN OUT</button>
    </div>`;
  card.append(form);
  const email = form.querySelector("#market-email");
  const password = form.querySelector("#market-password");
  const message = form.querySelector("#email-auth-message");
  const signIn = form.querySelector("#email-sign-in");
  const create = form.querySelector("#email-create");
  const signOutButton = form.querySelector("#email-sign-out");
  const googleButton = form.querySelector("#email-google");
  const resetButton = form.querySelector("#email-reset");
  let creating = false;
  create.addEventListener("click", () => {
    creating = !creating;
    password.autocomplete = creating ? "new-password" : "current-password";
    password.minLength = creating ? 8 : 1;
    signIn.textContent = creating ? "CREATE ACCOUNT" : "SIGN IN";
    create.textContent = creating ? "USE EXISTING ACCOUNT" : "CREATE ACCOUNT";
    message.textContent = creating
      ? "Create a new account with Supabase Auth. Verify your email if confirmation is enabled."
      : "Sign in with your Supabase email and password.";
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    signIn.disabled = true;
    create.disabled = true;
    message.textContent = creating ? "Creating your account securely…" : "Signing in securely…";
    try {
      if (creating) {
        const { data, error } = await supabase.auth.signUp({
          email: email.value.trim(),
          password: password.value,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        message.textContent = data.session
          ? "Account created and signed in. You can now connect Upstox."
          : "Account created. Check your email to confirm the address, then sign in.";
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.value.trim(),
          password: password.value
        });
        if (error) throw error;
        message.textContent = "Signed in securely with Supabase.";
      }
    } catch (error) {
      const messages = {
        "Invalid login credentials": "Email or password is incorrect.",
        "Email not confirmed": "Verify your email address, then sign in again.",
        "User already registered": "This email already has an account. Choose sign in.",
        "Password should be at least 8 characters": "Choose a password with at least 8 characters.",
        "Too many requests": "Too many attempts. Wait before trying again."
      };
      message.textContent = messages[error?.message] || error?.message || "Authentication failed. Please retry.";
    } finally {
      signIn.disabled = false;
      create.disabled = false;
    }
  });
  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;
    message.textContent = "Redirecting to Google securely…";
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname }
      });
      if (error) throw error;
    } catch (error) {
      message.textContent = error?.message || "Google sign-in could not be started. Check the Supabase Google provider configuration.";
      googleButton.disabled = false;
    }
  });
  resetButton.addEventListener("click", async () => {
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      message.textContent = "Enter your account email first to receive a password reset link.";
      email.focus();
      return;
    }
    resetButton.disabled = true;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: location.origin + location.pathname
      });
      if (error) throw error;
      message.textContent = "If this email belongs to an account, a password reset link has been sent.";
    } catch (error) {
      message.textContent = error?.message || "Password reset could not be requested.";
    } finally { resetButton.disabled = false; }
  });
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    message.textContent = error?.message || "Signed out.";
    signOutButton.disabled = false;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      message.textContent = "Signed in as " + (session.user.email || "your account") + " using Supabase Auth.";
      email.hidden = true;
      password.hidden = true;
      signIn.hidden = true;
      create.hidden = true;
      googleButton.hidden = true;
      resetButton.hidden = true;
      signOutButton.hidden = false;
    } else {
      email.hidden = false;
      password.hidden = false;
      signIn.hidden = false;
      create.hidden = false;
      googleButton.hidden = false;
      resetButton.hidden = false;
      signOutButton.hidden = true;
    }
  });
}
