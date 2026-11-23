"use strict";

async function readUserUpstoxConnection(serviceDb, userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("A verified Supabase user ID is required.");
  }
  return serviceDb
    .from("upstox_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
}

module.exports = {readUserUpstoxConnection};
