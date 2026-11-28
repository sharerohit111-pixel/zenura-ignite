"use strict";
const BROKER_AUTH_CONTRACTS = Object.freeze({
  upstox: Object.freeze({ brokerId: "upstox", mode: "authorization_code", authorizationEndpoint: "https://api.upstox.com/v2/login/authorization/dialog", tokenEndpoint: "https://api.upstox.com/v2/login/authorization/token", callbackStateRequired: true, refresh: false }),
  fyers: Object.freeze({ brokerId: "fyers", mode: "authorization_code", authorizationEndpoint: "https://api-t1.fyers.in/api/v3/generate-authcode", tokenEndpoint: "https://api-t1.fyers.in/api/v3/validate-authcode", callbackStateRequired: true, refresh: true, refreshValidityDays: 15 }),
  angel_one: Object.freeze({ brokerId: "angel_one", mode: "smartapi_session", callbackStateRequired: false, refresh: "provider_session_contract" })
});
function getBrokerAuthContract(brokerId) { return BROKER_AUTH_CONTRACTS[brokerId] || null; }
function buildAuthorizationUrl({ brokerId, clientId, redirectUri, state, responseType = "code" }) {
  const contract = getBrokerAuthContract(brokerId);
  if (!contract || contract.mode !== "authorization_code") throw new TypeError("Broker does not use this OAuth authorization-code flow.");
  for (const [name, value] of Object.entries({ clientId, redirectUri, state })) {
    if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new TypeError("Invalid OAuth " + name + ".");
  }
  const url = new URL(contract.authorizationEndpoint);
  if (brokerId === "upstox") {
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", responseType);
    url.searchParams.set("state", state);
  } else {
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", responseType);
    url.searchParams.set("state", state);
  }
  return url.toString();
}
module.exports = { BROKER_AUTH_CONTRACTS, getBrokerAuthContract, buildAuthorizationUrl };
