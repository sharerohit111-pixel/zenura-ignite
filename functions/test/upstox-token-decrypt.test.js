"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {decryptPendingUpstoxToken}=require("../lib/upstox-token-decrypt");

function encrypt(value,key){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  const data=Buffer.concat([cipher.update(value),cipher.final()]);
  return {v:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")};
}

test("decrypts normal opaque access tokens containing letters and digits",()=>{
  const key=crypto.randomBytes(32);
  const token="u0f9A1b2C3d4E5f6_access-token";
  assert.equal(decryptPendingUpstoxToken(encrypt(Buffer.from(token),key),key.toString("base64")),token);
});

test("rejects malformed keys, envelopes and non-canonical base64",()=>{
  const key=crypto.randomBytes(32),box=encrypt(Buffer.from("opaque-token"),key);
  assert.throws(()=>decryptPendingUpstoxToken(box,"bad-key"));
  assert.throws(()=>decryptPendingUpstoxToken({...box,iv:"not-base64"},key.toString("base64")));
  assert.throws(()=>decryptPendingUpstoxToken({...box,tag:"AA=="},key.toString("base64")));
  assert.throws(()=>decryptPendingUpstoxToken({...box,data:"AA=="},key.toString("base64")));
  assert.throws(()=>decryptPendingUpstoxToken({...box,v:2},key.toString("base64")));
});

test("rejects tampered ciphertext and authenticated control-character or invalid UTF-8 plaintext",()=>{
  const key=crypto.randomBytes(32),box=encrypt(Buffer.from("opaque-token"),key);
  const tampered={...box,data:Buffer.from("tampered").toString("base64")};
  assert.throws(()=>decryptPendingUpstoxToken(tampered,key.toString("base64")));
  for(const bytes of [Buffer.from("\nforged"),Buffer.from([0xff,0xfe]),Buffer.alloc(0)]){
    assert.throws(()=>decryptPendingUpstoxToken(encrypt(bytes,key),key.toString("base64")));
  }
});
