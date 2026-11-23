"use strict";

async function revokeUpstoxAccessToken(accessToken, {fetchProvider, readProviderJson}) {
  if (typeof accessToken !== "string" || !accessToken.trim()
    || typeof fetchProvider !== "function" || typeof readProviderJson !== "function") {
    return false;
  }
  try {
    const response = await fetchProvider("https://api.upstox.com/v2/logout", {
      method: "DELETE",
      headers: {Authorization: "Bearer " + accessToken, Accept: "application/json"}
    });
    if (!response || !response.ok) return false;
    const payload = await readProviderJson(response);
    return payload?.status === "success" && payload?.data === true;
  } catch {
    return false;
  }
}

module.exports = {revokeUpstoxAccessToken};
