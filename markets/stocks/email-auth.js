/* Email/password sign-in for the isolated Indian-market Firebase account.
 * Google sign-in remains available through the existing Connect button. */
import { auth } from "../../firebase-client.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

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
  form.hidden = false;
  form.innerHTML = `
    <small id="email-auth-message">Or use your email and password. Google sign-in is also available.</small>
    <input id="market-email" type="email" autocomplete="username" placeholder="Email address" required maxlength="254">
    <input id="market-password" type="password" autocomplete="current-password" placeholder="Password (minimum 6 characters)" required minlength="6" maxlength="128">
    <div class="email-auth-actions">
      <button type="submit" id="email-sign-in">SIGN IN WITH EMAIL</button>
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
    signIn.textContent = creating ? "CREATE ACCOUNT" : "SIGN IN WITH EMAIL";
    create.textContent = creating ? "USE EXISTING ACCOUNT" : "CREATE ACCOUNT";
    message.textContent = creating
      ? "Create a new account with this email and password."
      : "Sign in with your existing email and password.";
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    signIn.disabled = true;
    create.disabled = true;
    message.textContent = creating ? "Creating your account…" : "Signing in securely…";
    try {
      const credential = creating
        ? await createUserWithEmailAndPassword(auth, email.value.trim(), password.value)
        : await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      if (creating) {
        try {
          await sendEmailVerification(credential.user);
          message.textContent = "Account created. Verification email sent. Verify your email, then sign in and connect Upstox.";
        } catch (verificationError) {
          const verificationCode = verificationError?.code || "";
          message.textContent = verificationCode === "auth/too-many-requests"
            ? "Account created, but verification email was rate-limited. Wait before requesting another email."
            : "Account created, but the verification email could not be sent. Check Firebase Email Templates and try again later.";
        }
      } else {
        message.textContent = "Signed in. You can now connect your Upstox account.";
      }
      window.dispatchEvent(new Event("zenura-market-auth-ready"));
    } catch (error) {
      const code = error?.code || "";
      const messages = {
        "auth/email-already-in-use": "This email already has an account. Choose sign in.",
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/weak-password": "Choose a stronger password (at least 6 characters).",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/operation-not-allowed": "Enable Email/Password in Firebase Authentication → Sign-in method.",
        "auth/too-many-requests": "Too many attempts. Please wait and retry.",
        "auth/network-request-failed": "Network error. Check your connection and retry."
      };
      message.textContent = messages[code] || error.message || "Email sign-in failed.";
    } finally {
      signIn.disabled = false;
      create.disabled = false;
    }
  });
  signOutButton.addEventListener("click", async () => {
    try { await signOut(auth); message.textContent = "Signed out."; }
    catch (error) { message.textContent = error.message || "Sign out failed."; }
  });
  onAuthStateChanged(auth, user => {
    if (user) {
      message.textContent = "Signed in as " + (user.email || "your account") + ".";
      email.hidden = true;
      password.hidden = true;
      signIn.hidden = true;
      create.hidden = true;
      signOutButton.hidden = false;
      signOutButton.textContent = "SIGN OUT";
    } else {
      email.hidden = false;
      password.hidden = false;
      signIn.hidden = false;
      create.hidden = false;
      signOutButton.hidden = true;
    }
  });
}
