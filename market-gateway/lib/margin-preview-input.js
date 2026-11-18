"use strict";

function parseMarginPreviewInput(body){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(!body||typeof body!=="object"||Array.isArray(body))fail("A valid margin preview request body is required.");
 const instrumentKey=typeof body.instrument_key==="string"?body.instrument_key.trim():"";
 if(!instrumentKey||instrumentKey.length>100||/[\r\n]/.test(instrumentKey))
  fail("A valid instrument_key is required.");
 if(typeof body.lots!=="number"||!Number.isSafeInteger(body.lots)||body.lots<1||body.lots>10000)
  fail("Lots must be a whole number between 1 and 10,000.");
 if(typeof body.side!=="string"||!["BUY","SELL"].includes(body.side.toUpperCase()))
  fail("Margin preview side must be BUY or SELL.");
 const product=body.product===undefined?"D":typeof body.product==="string"?body.product.toUpperCase():"";
 if(!["I","D"].includes(product))
  fail("Margin preview product must be I (Intraday) or D (Delivery).");
 return {instrumentKey,lots:body.lots,side:body.side.toUpperCase(),product};
}

module.exports={parseMarginPreviewInput};
