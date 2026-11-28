/* Supabase email/password and Google OAuth authentication for ZENURA IGNITE. */
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

  const message = document.createElement("small");
  message.id = "email-auth-message";
  message.setAttribute("role", "status");
  message.textContent = "Choose Email & Password or continue securely with Google.";

  const email = document.createElement("input");
  email.id = "market-email";
  email.type = "email";
  email.autocomplete = "username";
  email.placeholder = "Email address";
  email.required = true;
  email.maxLength = 254;

  const password = document.createElement("input");
  password.id = "market-password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = "Password (minimum 8 characters)";
  password.required = true;
  password.minLength = 8;
  password.maxLength = 128;

  const actions = document.createElement("div");
  actions.className = "email-auth-actions";

  const signIn = document.createElement("button");
  signIn.type = "submit";
  signIn.id = "email-sign-in";
  signIn.textContent = "SIGN IN";

  const create = document.createElement("button");
  create.type = "button";
  create.id = "email-create";
  create.textContent = "CREATE ACCOUNT";

  const google = document.createElement("button");
  google.type = "button";
  google.id = "google-sign-in";
  google.className = "email-auth-google";
  google.textContent = "CONTINUE WITH GOOGLE";

  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.id = "email-sign-out";
  signOutButton.textContent = "SIGN OUT";
  signOutButton.hidden = true;

  actions.append(signIn, create, signOutButton);
  form.append(message, email, password, actions, google);
  card.append(form);

  function setBusy(busy, status) {
    signIn.disabled = busy;
    create.disabled = busy;
    google.disabled = busy;
    if (status) message.textContent = status;
  }

  create.addEventListener("click", async () => {
    if (!email.value.trim() || !password.value) {
      message.textContent = "Enter your email address and password first.";
      email.focus();
      return;
    }
    if (!form.reportValidity()) return;
    setBusy(true, "Creating your account securely…");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.value.trim(),
        password: password.value,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
      message.textContent = data.session
        ? "Account created. You are now signed in."
        : "Account created. Check your inbox and confirm your email using the link sent by Supabase. After confirmation, return here and sign in.";
    } catch (error) {
      const known = {
        "User already registered": "This email already has an account. Choose SIGN IN.",
        "Password should be at least 8 characters": "Choose a password with at least 8 characters.",
        "Too many requests": "Too many attempts. Wait before trying again."
      };
      message.textContent = known[error?.message] || error?.message || "Account creation failed. Please retry.";
    } finally {
      setBusy(false);
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setBusy(true, "Signing in securely…");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      if (error) throw error;
      message.textContent = "Signed in securely with Supabase.";
    } catch (error) {
      const known = {
        "Invalid login credentials": "Email or password is incorrect.",
        "Email not confirmed": "Email confirmation is still enabled for this account.",
        "Too many requests": "Too many attempts. Wait before trying again."
      };
      message.textContent = known[error?.message] || error?.message || "Sign-in failed. Please retry.";
    } finally {
      setBusy(false);
    }
  });

  google.addEventListener("click", async () => {
    setBusy(true, "Connecting to Google…");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
    } catch (error) {
      message.textContent = error?.message || "Google sign-in is not configured yet. Enable the Google provider in Supabase first.";
      setBusy(false);
    }
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    message.textContent = error?.message || "Signed out.";
    signOutButton.disabled = false;
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const signedIn = Boolean(session?.user);
    if (signedIn) {
      message.textContent = "Signed in as " + (session.user.email || "your account") + " using Supabase Auth.";
      email.hidden = true;
      password.hidden = true;
      signIn.hidden = true;
      create.hidden = true;
      google.hidden = true;
      signOutButton.hidden = false;
    } else {
      email.hidden = false;
      password.hidden = false;
      signIn.hidden = false;
      create.hidden = false;
      google.hidden = false;
      signOutButton.hidden = true;
    }
  });
}
