"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeTheme,nextTheme,actionLabel}=require("./chart-theme");

test("chart theme defaults safely to dark and only accepts supported values",()=>{
  assert.equal(normalizeTheme(null),"dark");
  assert.equal(normalizeTheme("unknown"),"dark");
  assert.equal(normalizeTheme("light"),"light");
  assert.equal(normalizeTheme("dark"),"dark");
});

test("chart theme toggles between light and dark",()=>{
  assert.equal(nextTheme("dark"),"light");
  assert.equal(nextTheme("light"),"dark");
  assert.equal(nextTheme("invalid"),"light");
});

test("theme action label follows active theme and interface language",()=>{
  assert.equal(actionLabel("dark","en"),"LIGHT CHART");
  assert.equal(actionLabel("light","en"),"DARK CHART");
  assert.equal(actionLabel("dark","hi"),"हल्का चार्ट");
  assert.equal(actionLabel("light","hi"),"गहरा चार्ट");
});
