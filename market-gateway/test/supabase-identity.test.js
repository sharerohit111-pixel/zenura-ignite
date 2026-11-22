"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSupabaseUserId } = require("../lib/supabase-identity");

function fakeSupabase({ data = null, error = null, thrown = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            eq(column, value) {
              calls.push(["eq", column, value]);
              return {
                async maybeSingle() {
                  if (thrown) throw thrown;
                  return { data, error };
                }
              };
            }
          };
        }
      };
    }
  };
  return { client, calls };
}

test("resolves an existing Firebase UID to its internal Supabase UUID", async () => {
  const firebaseUid = "firebase-UID-CaseSensitive-123";
  const { client, calls } = fakeSupabase({
    data: { supabase_user_id: "A1B2C3D4-E5F6-4789-ABCD-0123456789AB" }
  });

  const id = await resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid });

  assert.equal(id, "a1b2c3d4-e5f6-4789-abcd-0123456789ab");
  assert.deepEqual(calls, [
    ["from", "paper_user_identity_map"],
    ["select", "supabase_user_id"],
    ["eq", "firebase_uid", firebaseUid]
  ]);
});

test("rejects a missing or whitespace Firebase UID before querying", async () => {
  const { client, calls } = fakeSupabase();
  await assert.rejects(
    resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid: "   " }),
    error => error.status === 401 && error.code === "FIREBASE_IDENTITY_INVALID"
  );
  assert.equal(calls.length, 0);
});

test("fails closed when the Firebase user has not been migrated", async () => {
  const { client } = fakeSupabase({ data: null });
  await assert.rejects(
    resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid: "legacy-firebase-uid" }),
    error => error.status === 409 && error.code === "SUPABASE_IDENTITY_NOT_MIGRATED"
  );
});

test("does not expose Supabase lookup errors", async () => {
  const { client } = fakeSupabase({ error: { message: "private database detail" } });
  await assert.rejects(
    resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid: "legacy-firebase-uid" }),
    error => error.status === 503 &&
      error.code === "SUPABASE_IDENTITY_LOOKUP_FAILED" &&
      !error.message.includes("private database detail")
  );
});

test("rejects malformed mapped UUIDs", async () => {
  const { client } = fakeSupabase({ data: { supabase_user_id: "not-a-uuid" } });
  await assert.rejects(
    resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid: "legacy-firebase-uid" }),
    error => error.status === 503 && error.code === "SUPABASE_IDENTITY_MAPPING_INVALID"
  );
});

test("does not auto-provision an unmigrated user or initialize virtual capital", async () => {
  const { client, calls } = fakeSupabase({ data: null });
  await assert.rejects(
    resolveSupabaseUserId({ supabaseAdmin: client, firebaseUid: "legacy-firebase-uid" }),
    error => error.code === "SUPABASE_IDENTITY_NOT_MIGRATED"
  );
  assert.deepEqual(calls.map(call => call[0]), ["from", "select", "eq"]);
});
