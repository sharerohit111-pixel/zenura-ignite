import { auth, db } from "../firebase-client.js";
import {
  collection, collectionGroup, doc, getDoc, getDocs, query, where, limit,
  writeBatch, addDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const storeRef = id => doc(db, "kiranaStores", id);
const memberRef = (storeId, uid) => doc(db, "kiranaStores", storeId, "members", uid);
const productRef = (storeId, id) => doc(db, "kiranaStores", storeId, "products", id);
const customerRef = (storeId, id) => doc(db, "kiranaStores", storeId, "customers", id);
const ledgerRef = (storeId, customerId, id) => doc(db, "kiranaStores", storeId, "customers", customerId, "ledger", id);
const requireUser = () => {
  const u = auth.currentUser;
  if (!u) throw new Error("Please sign in first.");
  return u;
};
const requireText = (v, label, max=120) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new Error(label + " is required.");
  return v.trim();
};
const amount = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) throw new Error("Enter a valid " + label + ".");
  return Math.round(n * 100) / 100;
};
const rows = snap => snap.docs.map(d => ({id:d.id,...d.data()}));

async function kiranaListMyStores() {
  const u=requireUser();
  const memberships=await getDocs(query(collectionGroup(db,"members"),where("uid","==",u.uid),where("active","==",true),limit(100)));
  const stores=await Promise.all(memberships.docs.map(async m=>{
    const parent=m.ref.parent.parent;
    if(!parent) return null;
    const s=await getDoc(parent);
    return s.exists() ? {storeId:s.id,name:s.data().name,role:m.data().role} : null;
  }));
  return {stores:stores.filter(Boolean)};
}
async function kiranaCreateStore(data) {
  const u=requireUser(), name=requireText(data.name,"Store name",100);
  const phone=requireText(data.phone,"Store mobile",20), address=String(data.address||"Not added").trim().slice(0,250)||"Not added";
  const s=doc(collection(db,"kiranaStores")), m=memberRef(s.id,u.uid), batch=writeBatch(db);
  batch.set(s,{name,phone,address,ownerUid:u.uid,status:"active",currency:"INR",timezone:"Asia/Kolkata",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  batch.set(m,{uid:u.uid,role:"owner",active:true,permissions:["products","billing","customers","reports","settings"],createdAt:serverTimestamp()});
  await batch.commit();
  return {storeId:s.id,name};
}
async function kiranaListProducts(data) {
  requireUser();
  const q=query(collection(db,"kiranaStores",requireText(data.storeId,"Store"),"products"),where("active","==",true),limit(500));
  return {products:rows(await getDocs(q))};
}
async function kiranaAddProduct(data) {
  const u=requireUser(), storeId=requireText(data.storeId,"Store");
  const name=requireText(data.name,"Product name",120);
  const retailPrice=amount(data.retailPrice,"retail price");
  const wholesalePrice=data.wholesalePrice==null?retailPrice:amount(data.wholesalePrice,"wholesale price");
  const openingStock=Number(data.openingStock??0), lowStockAt=Number(data.lowStockAt??0);
  if(!Number.isFinite(openingStock)||openingStock<0||openingStock>100000000||!Number.isFinite(lowStockAt)||lowStockAt<0) throw new Error("Enter valid stock quantities.");
  const ref=await addDoc(collection(db,"kiranaStores",storeId,"products"),{
    name,sku:String(data.sku||"").trim().slice(0,40),unit:String(data.unit||"piece").trim().slice(0,20),
    retailPrice,wholesalePrice,stock:openingStock,lowStockAt,barcode:String(data.barcode||"").slice(0,80),
    active:true,createdBy:u.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  return {productId:ref.id};
}
async function kiranaCreateSale(data) {
  const u=requireUser(), storeId=requireText(data.storeId,"Store");
  if(!Array.isArray(data.items)||!data.items.length||data.items.length>100) throw new Error("Add at least one bill item.");
  const combined=new Map();
  for(const item of data.items){
    const id=requireText(item.productId,"Product",120), qty=Number(item.quantity);
    if(!Number.isFinite(qty)||qty<=0||qty>100000000) throw new Error("Invalid quantity.");
    const key=id+"|"+(item.priceType==="wholesale"?"wholesale":"retail");
    const old=combined.get(key)||{productId:id,quantity:0,priceType:item.priceType==="wholesale"?"wholesale":"retail"};
    old.quantity+=qty; combined.set(key,old);
  }
  const items=[...combined.values()];
  if(items.length>3) throw new Error("A bill can contain up to 3 different products in this free release.");
  if(new Set(items.map(x=>x.productId)).size!==items.length) throw new Error("Use one price type per product in a single bill.");
  const paymentMode=["cash","upi","card","credit"].includes(data.paymentMode)?data.paymentMode:"cash";
  const customerId=paymentMode==="credit"?requireText(data.customerId,"Customer"):"";
  const saleId=doc(collection(db,"kiranaStores",storeId,"sales")).id;
  const invoiceNo="KRN-"+Date.now().toString(36).toUpperCase()+"-"+saleId.slice(0,6).toUpperCase();
  const productRefs=items.map(x=>productRef(storeId,x.productId));
  const member=memberRef(storeId,u.uid), customer=customerId?customerRef(storeId,customerId):null;
  let total=0;
  await runTransaction(db,async tx=>{
    const memberSnap=await tx.get(member);
    if(!memberSnap.exists()||memberSnap.data().active!==true||!["owner","manager","cashier"].includes(memberSnap.data().role)) throw new Error("Store access denied.");
    const productSnaps=[];
    for(const ref of productRefs) productSnaps.push(await tx.get(ref));
    const customerSnap=customer?await tx.get(customer):null;
    if(customer&&(!customerSnap.exists()||customerSnap.data().active!==true)) throw new Error("Customer not found.");
    const lines=items.map((item,i)=>{
      const snap=productSnaps[i];
      if(!snap.exists()||snap.data().active!==true) throw new Error("A product is unavailable.");
      const p=snap.data(), price=item.priceType==="wholesale"?p.wholesalePrice:p.retailPrice;
      if(typeof price!=="number"||p.stock<item.quantity) throw new Error("Insufficient stock or invalid price for "+p.name+".");
      return {productId:snap.id,name:p.name,sku:p.sku||"",unit:p.unit||"piece",quantity:item.quantity,price,priceType:item.priceType,amount:Math.round(item.quantity*price*100)/100};
    });
    total=Math.round(lines.reduce((sum,line)=>sum+line.amount,0)*100)/100;
    const stockChanges={};
    lines.forEach((line,i)=>{stockChanges[line.productId]=line.quantity;tx.update(productRefs[i],{stock:productSnaps[i].data().stock-line.quantity,lastSaleId:saleId,updatedAt:serverTimestamp()});});
    const sale=doc(db,"kiranaStores",storeId,"sales",saleId);
    tx.set(sale,{saleId,invoiceNo,items:lines,stockChanges,subtotal:total,tax:0,discount:0,total,paymentMode,customerId:customerId||null,customerName:customerSnap?customerSnap.data().name:"Walk-in Customer",createdBy:u.uid,createdAt:serverTimestamp(),status:"completed"});
    if(customer){
      const c=customerSnap.data(), nextBalance=Math.round((Number(c.creditBalance||0)+total)*100)/100;
      tx.update(customer,{creditBalance:nextBalance,totalCredit:Math.round((Number(c.totalCredit||0)+total)*100)/100,lastLedgerId:saleId,updatedAt:serverTimestamp()});
      tx.set(ledgerRef(storeId,customerId,saleId),{type:"credit_sale",amount:total,invoiceId:invoiceNo,saleId,createdBy:u.uid,createdAt:serverTimestamp(),note:"Counter billing credit sale"});
    }
  });
  return {saleId,invoiceNo,total};
}
async function kiranaListCustomers(data) {
  requireUser();
  const q=query(collection(db,"kiranaStores",requireText(data.storeId,"Store"),"customers"),where("active","==",true),limit(500));
  return {customers:rows(await getDocs(q))};
}
async function kiranaAddCustomer(data) {
  const u=requireUser(),storeId=requireText(data.storeId,"Store"),name=requireText(data.name,"Customer name",120),phone=String(data.phone||"").trim();
  if(phone&&!/^[0-9+ -]{7,20}$/.test(phone)) throw new Error("Enter a valid customer mobile number.");
  const ref=await addDoc(collection(db,"kiranaStores",storeId,"customers"),{name,phone,creditBalance:0,totalCredit:0,totalPaid:0,active:true,createdBy:u.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return {customerId:ref.id};
}
async function kiranaRecordCustomerCredit(data) {
  const u=requireUser(),storeId=requireText(data.storeId,"Store"),customerId=requireText(data.customerId,"Customer"),value=amount(data.amount,"credit amount"),invoiceId=requireText(data.invoiceId,"Invoice reference",80);
  const id=doc(collection(db,"kiranaStores",storeId,"customers",customerId,"ledger")).id;
  await runTransaction(db,async tx=>{
    const m=await tx.get(memberRef(storeId,u.uid)),c=await tx.get(customerRef(storeId,customerId));
    if(!m.exists()||m.data().active!==true||!["owner","manager","cashier"].includes(m.data().role)) throw new Error("Store access denied.");
    if(!c.exists()||c.data().active!==true) throw new Error("Customer not found.");
    const d=c.data();
    tx.update(customerRef(storeId,customerId),{creditBalance:Math.round((Number(d.creditBalance||0)+value)*100)/100,totalCredit:Math.round((Number(d.totalCredit||0)+value)*100)/100,lastLedgerId:id,updatedAt:serverTimestamp()});
    tx.set(ledgerRef(storeId,customerId,id),{type:"manual_credit",amount:value,invoiceId,createdBy:u.uid,createdAt:serverTimestamp(),note:"Manual customer credit"});
  });
  return {entryId:id};
}
async function kiranaRecordCreditPayment(data) {
  const u=requireUser(),storeId=requireText(data.storeId,"Store"),customerId=requireText(data.customerId,"Customer"),value=amount(data.amount,"payment amount");
  const mode=["cash","upi","card","bank"].includes(data.paymentMode)?data.paymentMode:"cash";
  const id=doc(collection(db,"kiranaStores",storeId,"customers",customerId,"ledger")).id;
  await runTransaction(db,async tx=>{
    const m=await tx.get(memberRef(storeId,u.uid)),c=await tx.get(customerRef(storeId,customerId));
    if(!m.exists()||m.data().active!==true||!["owner","manager","cashier"].includes(m.data().role)) throw new Error("Store access denied.");
    if(!c.exists()||c.data().active!==true) throw new Error("Customer not found.");
    const d=c.data(),balance=Number(d.creditBalance||0);
    if(value>balance) throw new Error("Payment cannot exceed the outstanding balance.");
    tx.update(customerRef(storeId,customerId),{creditBalance:Math.round((balance-value)*100)/100,totalPaid:Math.round((Number(d.totalPaid||0)+value)*100)/100,lastLedgerId:id,updatedAt:serverTimestamp()});
    tx.set(ledgerRef(storeId,customerId,id),{type:"payment",amount:value,mode,createdBy:u.uid,createdAt:serverTimestamp(),note:String(data.note||"").slice(0,200)});
  });
  return {paymentId:id};
}
export const kiranaApi = {
  kiranaListMyStores,kiranaCreateStore,kiranaListProducts,kiranaAddProduct,kiranaCreateSale,
  kiranaListCustomers,kiranaAddCustomer,kiranaRecordCustomerCredit,kiranaRecordCreditPayment
};
