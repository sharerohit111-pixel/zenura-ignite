"use strict";
function isVerifiedPasswordAccount(auth) {
  if (!auth || typeof auth !== "object") return false;
  const provider = auth.token?.firebase?.sign_in_provider;
  if (provider !== "password") return true;
  return auth.token?.email_verified === true;
}
module.exports = {isVerifiedPasswordAccount};
