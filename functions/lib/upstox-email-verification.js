"use strict";
function isVerifiedPasswordAccount(auth) {
  if (!auth || typeof auth !== "object") return false;
  const provider = auth.token?.firebase?.sign_in_provider;
  if (provider === "password") return auth.token?.email_verified === true;
  // Only the two sign-in methods exposed by the Indian-market UI may start OAuth.
  // Do not implicitly trust anonymous, custom-token, phone or unknown providers.
  return provider === "google.com";
}
module.exports = {isVerifiedPasswordAccount};
