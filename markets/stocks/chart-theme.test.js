"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {normalizeTheme,nextTheme,actionLabel,mount,STORAGE_KEY}=require("./chart-theme");

function fakeElement(text=""){
  const listeners=new Map(),attributes=new Map();
  return {
    textContent:text,
    dataset:{},
    attributes,
    addEventListener(name,callback){listeners.set(name,callback);},
    setAttribute(name,value){attributes.set(name,value);},
    click(){listeners.get("click")?.();},
    dispatch(name){listeners.get(name)?.();}
  };
}

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

test("mount restores, toggles and persists the selected theme",()=>{
  const button=fakeElement(),languageButton=fakeElement("हिन्दी");
  const body={dataset:{}};
  const values=new Map([[STORAGE_KEY,"light"]]);
  const documentRef={body,getElementById(id){
    return id==="paper-chart-theme-toggle"?button:
      id==="paper-language-toggle"?languageButton:null;
  }};
  const controller=mount(documentRef,()=>({
    getItem:key=>values.get(key)||null,
    setItem:(key,value)=>values.set(key,value)
  }));

  assert.equal(controller.getTheme(),"light");
  assert.equal(body.dataset.chartTheme,"light");
  assert.equal(button.textContent,"DARK CHART");
  assert.equal(button.attributes.get("aria-pressed"),"true");

  button.click();
  assert.equal(controller.getTheme(),"dark");
  assert.equal(values.get(STORAGE_KEY),"dark");
  assert.equal(body.dataset.chartTheme,"dark");
  assert.equal(button.textContent,"LIGHT CHART");
  assert.equal(button.attributes.get("aria-pressed"),"false");

  languageButton.textContent="English";
  languageButton.dispatch("click");
  assert.equal(button.textContent,"हल्का चार्ट");
});

test("mount tolerates unavailable storage and missing page controls",()=>{
  const button=fakeElement(),body={dataset:{}};
  const documentRef={body,getElementById:id=>id==="paper-chart-theme-toggle"?button:null};
  const controller=mount(documentRef,()=>{throw new Error("storage unavailable");});
  assert.equal(controller.getTheme(),"dark");
  assert.equal(body.dataset.chartTheme,"dark");
  assert.equal(mount({getElementById:()=>null},()=>null),null);
});

test("stocks page wires the chart theme stylesheet, controls and module",()=>{
  const html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8");
  const css=fs.readFileSync(path.join(__dirname,"chart-theme.css"),"utf8");
  assert.match(html,/<body class="stocks-page"/);
  assert.match(html,/<link rel="stylesheet" href="\.\/chart-theme\.css">/);
  assert.match(html,/<button[^>]+id="paper-chart-theme-toggle"/);
  assert.match(html,/<button[^>]+id="paper-language-toggle"/);
  assert.match(html,/<script src="\.\/chart-theme\.js"><\/script>/);
  assert.match(css,/\.stocks-page\[data-chart-theme="light"\]/);
  assert.match(css,/\.chart-theme-toggle:focus-visible/);
});
