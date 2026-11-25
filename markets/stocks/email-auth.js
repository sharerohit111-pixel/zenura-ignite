/* Native Supabase email/password authentication for ZENURA IGNITE. */
import { supabase } from "./supabase-client.js";

const card = document.getElementById("connection");
const connectButton = document.getElementById("upstox-connect");
if (card && connectButton) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./email-auth.css";
  document.head.append(stylesheet);
  const form = document.createElement("form");
  form.className = "email-auth";
  form.innerHTML = `
    <small id="email-auth-message">Create a new Supabase account or sign in. Firebase is not used for this app.</small>
    <input id="market-email" type="email" autocomplete="username" placeholder="Email address" required maxlength="254">
    <input id="market-password" type="password" autocomplete="current-password" placeholder="Password (minimum 8 characters)" required minlength="8" maxlength="128">
    <div class="email-auth-actions">
      <button type="submit" id="email-sign-in">SIGN IN</button>
      <button type="button" id="email-create">CREATE ACCOUNT</button>
      <button type="button" id="email-sign-out" hidden>SIGN OUT</button>
    </div>`;
  card.append(form);
  const email = form.querySelector("#market-email");
  const password = form.querySelector("#market-password");
  const message = form.querySelector("#email-auth-message");
  const signIn = form.querySelector("#email-sign-in");
  const create = form.querySelector("#email-create");
  const signOutButton = form.querySelector("#email-sign-out");
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
      signOutButton.hidden = false;
    } else {
      email.hidden = false;
      password.hidden = false;
      signIn.hidden = false;
      create.hidden = false;
      signOutButton.hidden = true;
    }
  });
}
