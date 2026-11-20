import { readFileSync } from "node:fs";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, writeBatch, serverTimestamp, collection, collectionGroup, query, where, getDocs } from "firebase/firestore";

let env;
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:"demo-zenura-kirana",
    firestore:{rules:readFileSync("firestore.rules","utf8")}
  });
});
after(async()=>{await env.cleanup();});
beforeEach(async()=>{await env.clearFirestore();});

async function createOwnedStore(uid="owner-1") {
  const db=env.authenticatedContext(uid,{email:"owner@example.com",email_verified:true}).firestore();
  const batch=writeBatch(db);
  batch.set(doc(db,"kiranaStores/store-1"),{
    name:"Test Kirana",phone:"9876543210",address:"Jaipur",
    ownerUid:uid,status:"active",currency:"INR",timezone:"Asia/Kolkata",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  batch.set(doc(db,"kiranaStores/store-1/members/"+uid),{
    uid,role:"owner",active:true,permissions:["products","billing","customers"],createdAt:serverTimestamp()
  });
  await assertSucceeds(batch.commit());
  return db;
}

test("owner can create a store and membership atomically",async()=>{
  await createOwnedStore();
  const db=env.authenticatedContext("owner-1").firestore();
  const snap=await assertSucceeds(getDoc(doc(db,"kiranaStores/store-1")));
  assert.equal(snap.data().ownerUid,"owner-1");
});

test("another signed-in user cannot read a store or its products",async()=>{
  await createOwnedStore();
  const other=env.authenticatedContext("intruder").firestore();
  await assertFails(getDoc(doc(other,"kiranaStores/store-1")));
  await assertFails(getDoc(doc(other,"kiranaStores/store-1/products/p1")));
});

test("member collection-group lookup is UID-scoped and filters inactive memberships",async()=>{
  await createOwnedStore();
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"kiranaStores/store-2/members/owner-1"),{
      uid:"owner-1",role:"owner",active:false,createdAt:new Date()
    });
  });
  const db=env.authenticatedContext("owner-1").firestore();
  const q=query(collectionGroup(db,"members"),where("uid","==","owner-1"),where("active","==",true));
  const snap=await assertSucceeds(getDocs(q));
  assert.equal(snap.size,1);
  assert.equal(snap.docs[0].data().active,true);
  const other=env.authenticatedContext("intruder").firestore();
  await assertFails(getDocs(query(collectionGroup(other,"members"),where("uid","==","owner-1"),where("active","==",true))));
});

test("owner can add a product but cannot directly edit stock",async()=>{
  const db=await createOwnedStore();
  const product=doc(db,"kiranaStores/store-1/products/p1");
  await assertSucceeds(setDoc(product,{
    name:"Rice",sku:"RICE-1",unit:"kg",retailPrice:60,wholesalePrice:55,
    stock:10,lowStockAt:2,barcode:"",active:true,createdBy:"owner-1",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  await assertFails(setDoc(product,{stock:100,updatedAt:serverTimestamp()},{merge:true}));
});

test("POS sale and stock decrement must be atomic and price-accurate",async()=>{
  const db=await createOwnedStore();
  const product=doc(db,"kiranaStores/store-1/products/p1");
  await assertSucceeds(setDoc(product,{
    name:"Rice",sku:"RICE-1",unit:"kg",retailPrice:60,wholesalePrice:55,
    stock:10,lowStockAt:2,barcode:"",active:true,createdBy:"owner-1",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  const batch=writeBatch(db);
  batch.update(product,{stock:8,lastSaleId:"sale-1",updatedAt:serverTimestamp()});
  batch.set(doc(db,"kiranaStores/store-1/sales/sale-1"),{
    saleId:"sale-1",invoiceNo:"KRN-TEST-1",
    items:[{productId:"p1",name:"Rice",sku:"RICE-1",unit:"kg",quantity:2,price:60,priceType:"retail",amount:120}],
    stockChanges:{p1:2},subtotal:120,tax:0,discount:0,total:120,
    paymentMode:"cash",customerId:null,customerName:"Walk-in Customer",
    createdBy:"owner-1",createdAt:serverTimestamp(),status:"completed"
  });
  await assertSucceeds(batch.commit());
  const saved=await getDoc(product);
  assert.equal(saved.data().stock,8);
});

test("credit sale atomically updates stock, customer balance, and ledger",async()=>{
  const db=await createOwnedStore();
  const product=doc(db,"kiranaStores/store-1/products/p1");
  const customer=doc(db,"kiranaStores/store-1/customers/c1");
  await assertSucceeds(setDoc(product,{
    name:"Rice",sku:"RICE-1",unit:"kg",retailPrice:60,wholesalePrice:55,
    stock:10,lowStockAt:2,barcode:"",active:true,createdBy:"owner-1",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(customer,{
    name:"Asha",phone:"9876543210",creditBalance:0,totalCredit:0,totalPaid:0,
    active:true,createdBy:"owner-1",createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  const batch=writeBatch(db);
  batch.update(product,{stock:8,lastSaleId:"sale-credit-1",updatedAt:serverTimestamp()});
  batch.update(customer,{creditBalance:120,totalCredit:120,lastLedgerId:"sale-credit-1",updatedAt:serverTimestamp()});
  batch.set(doc(db,"kiranaStores/store-1/customers/c1/ledger/sale-credit-1"),{
    type:"credit_sale",amount:120,invoiceId:"KRN-CREDIT-1",saleId:"sale-credit-1",
    createdBy:"owner-1",createdAt:serverTimestamp(),note:"Counter billing credit sale"
  });
  batch.set(doc(db,"kiranaStores/store-1/sales/sale-credit-1"),{
    saleId:"sale-credit-1",invoiceNo:"KRN-CREDIT-1",
    items:[{productId:"p1",name:"Rice",sku:"RICE-1",unit:"kg",quantity:2,price:60,priceType:"retail",amount:120}],
    stockChanges:{p1:2},subtotal:120,tax:0,discount:0,total:120,
    paymentMode:"credit",customerId:"c1",customerName:"Asha",
    createdBy:"owner-1",createdAt:serverTimestamp(),status:"completed"
  });
  await assertSucceeds(batch.commit());
  const savedCustomer=await getDoc(customer);
  assert.equal(savedCustomer.data().creditBalance,120);
});
