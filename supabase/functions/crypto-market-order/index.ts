import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "PAXGUSDT", "XAUTUSDT"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "https://sharerohit111-pixel.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function decimal(value: unknown, label: string, max: number) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Invalid ${label}.`);
  }
  const raw = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(raw)) throw new Error(`Invalid ${label}.`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) throw new Error(`Invalid ${label}.`);
  return raw;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const startingCash = Deno.env.get("CRYPTO_STARTING_CASH_INR");
    const feeRateRaw = Deno.env.get("CRYPTO_TAKER_FEE_RATE");
    if (!supabaseUrl || !anonKey || !serviceKey || !startingCash || !feeRateRaw) {
      return json({ error: "Crypto trading service is not configured." }, 503);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Authentication required." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid or expired session." }, 401);
    const userId = authData.user.id;

    const body = await req.json();
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const side = typeof body.side === "string" ? body.side.toUpperCase() : "";
    if (!ALLOWED_SYMBOLS.has(symbol) || !["BUY", "SELL"].includes(side)) {
      return json({ error: "Unsupported crypto symbol or side." }, 400);
    }
    const baseAsset = symbol.slice(0, -4);
    const quantity = decimal(body.quantity, "quantity", 1_000_000_000);
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return json({ error: "Valid order and idempotency UUIDs are required." }, 400);
    }

    const feeRate = Number(feeRateRaw);
    const initial = Number(startingCash);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.05 ||
        !Number.isFinite(initial) || initial <= 0 || initial > 1_000_000_000) {
      return json({ error: "Crypto trading configuration is invalid." }, 503);
    }

    // Use a server-fetched latest Binance trade; never trust client-supplied price/timestamp.
    const marketResponse = await fetch(
      `https://api.binance.com/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=1`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (!marketResponse.ok) return json({ error: "Crypto market quote is temporarily unavailable." }, 502);
    const trades = await marketResponse.json();
    const latest = Array.isArray(trades) ? trades[0] : null;
    const price = Number(latest?.price);
    const quoteTimestamp = Number(latest?.time);
    const now = Date.now();
    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(quoteTimestamp) ||
        now - quoteTimestamp < -2000 || now - quoteTimestamp > 15000) {
      return json({ error: "A fresh Binance quote is not available. Retry shortly." }, 409);
    }

    const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000),
    });
    if (!fxResponse.ok) return json({ error: "INR reference rate is temporarily unavailable." }, 502);
    const fxData = await fxResponse.json();
    const fxRateInr = Number(fxData?.rates?.INR);
    if (fxData?.result !== "success" || !Number.isFinite(fxRateInr) || fxRateInr < 40 || fxRateInr > 200) {
      return json({ error: "A valid INR reference rate is unavailable." }, 502);
    }

    const gross = Number(quantity) * price * fxRateInr;
    if (!Number.isFinite(gross) || gross <= 0 || gross > 1_000_000_000_000) {
      return json({ error: "Order value is outside supported limits." }, 400);
    }
    const fee = Number((gross * feeRate).toFixed(8));
    const canonical = {
      userId, orderId, idempotencyKey, symbol, side, quantity,
      provider: "binance-spot", quoteTimestamp,
      executionPrice: price.toFixed(8), fxRateInr: fxRateInr.toFixed(8), fee: fee.toFixed(8),
    };
    const requestFingerprint = await fingerprint(canonical);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: initError } = await admin.rpc("initialize_paper_crypto_account", {
      p_user_id: userId,
      p_starting_cash_inr: initial,
    });
    if (initError) {
      console.error("crypto account initialization failed", initError.message);
      return json({ error: "Could not initialize the paper account." }, 500);
    }

    const { data, error } = await admin.rpc("execute_paper_crypto_market_order", {
      p_user_id: userId,
      p_order_id: orderId,
      p_idempotency_key: idempotencyKey,
      p_request_fingerprint: requestFingerprint,
      p_symbol: symbol,
      p_base_asset: baseAsset,
      p_side: side,
      p_quantity: quantity,
      p_execution_price: price.toFixed(8),
      p_fx_rate_inr: fxRateInr.toFixed(8),
      p_fee: fee.toFixed(8),
      p_quote_timestamp_ms: quoteTimestamp,
    });
    if (error) {
      console.error("crypto order execution failed", error.message);
      return json({ error: error.message.includes("Insufficient") ? error.message : "Paper order could not be executed." }, 422);
    }
    return json(data, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return json({ error: message }, 400);
  }
});
