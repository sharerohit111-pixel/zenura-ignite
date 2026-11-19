"use strict";
function isVerifiedPasswordAccount(auth) {
  if (!auth || typeof auth !== "object") return false;
  const provider = auth.token?.firebase?.sign_in_provider;
  if (typeof provider !== "string" || provider.length === 0) return false;
  if (provider === "password") return auth.token?.email_verified === true;
  return true;
}
module.exports = {isVerifiedPasswordAccount};
