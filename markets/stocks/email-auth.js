/* Native Supabase email/password authentication for ZENURA IGNITE. */
import { supabase } from "./supabase-client.js";

const card = document.getElementById("connection");
const connectButton = document.getElementById("upstox-connect");
if (card && connectButton) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "./email-auth.css";
  document.head.append(stylesheet);

  // Build the auth form with DOM APIs; never parse HTML strings in this security-sensitive UI.
  const form = document.createElement("form");
  form.className = "email-auth";

  const message = document.createElement("small");
  message.id = "email-auth-message";
  message.textContent = "Create a new Supabase account or sign in. Firebase is not used for this app.";

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

  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.id = "email-sign-out";
  signOutButton.textContent = "SIGN OUT";
  signOutButton.hidden = true;

  actions.append(signIn, create, signOutButton);
  form.append(message, email, password, actions);
  card.append(form);

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
