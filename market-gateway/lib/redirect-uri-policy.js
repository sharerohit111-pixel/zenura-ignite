"use strict";

function validateHttpsRedirectUri(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 2048
    || value.trim() !== value || /[\\u0000-\\u0020\\u007f]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password
    || url.search || url.hash || url.origin === "null") return null;
  // Reject ambiguous host forms and non-canonical URL spellings.
  if (url.hostname.endsWith(".") || url.hostname.includes("..")) return null;
  return url.toString();
}

module.exports = {validateHttpsRedirectUri};
