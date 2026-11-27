"use strict";
function isVerifiedPasswordAccount(auth) {
  if (!auth || typeof auth !== "object") return false;
  const provider = auth.token?.firebase?.sign_in_provider;
  // Only the two sign-in methods exposed by the Indian-market UI may start OAuth.
  // Both must carry Firebase's verified-email claim; never trust an absent claim.
  return (provider === "password" || provider === "google.com")
    && auth.token?.email_verified === true;
}
module.exports = {isVerifiedPasswordAccount};
