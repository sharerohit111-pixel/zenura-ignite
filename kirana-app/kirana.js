import { auth, googleProvider } from "../firebase-client.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
const functions = getFunctions(undefined, "asia-south1");
const api = name => httpsCallable(functions, name);
const $ = id => document.getElementById(id);
let user = null, stores = [], activeStore = "", products = [], bill = [];
function message(text, bad=false){$("message").textContent=text;$("message").className="message"+(bad?" error":"");}
function money(n){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(n||0));}
function showTab(name){document.querySelectorAll(".panel").forEach(x=>x.hidden=x.id!==name);document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));}
async function loadStores(){
 const result=await api("kiranaListMyStores")({});
 stores=result.data.stores||[];$("storeSelect").innerHTML="";
 stores.forEach(s=>{const o=document.createElement("option");o.value=s.storeId;o.textContent=s.name+" ("+s.role+")";$("storeSelect").append(o);});
 if(!stores.length){const name=prompt("Enter your store name");if(!name?.trim())return;const phone=prompt("Store mobile number");if(!phone?.trim())return;const address=prompt("Store address (optional)")||"Not added";const made=await api("kiranaCreateStore")({name,phone,address});stores=[{storeId:made.data.storeId,name,role:"owner"}];const o=document.createElement("option");o.value=made.data.storeId;o.textContent=name+" (owner)";$("storeSelect").append(o);}
 activeStore=$("storeSelect").value||stores[0].storeId;$("storeSelect").value=activeStore;$("roleLabel").textContent=stores.find(s=>s.storeId===activeStore)?.role||"—";
 $("workspace").hidden=false;$("signedOut").hidden=true;await loadProducts();
}
async function loadProducts(){
 const r=await api("kiranaListProducts")({storeId:activeStore});products=r.data.products||[];
 $("productCount").textContent=products.length;$("lowStockCount").textContent=products.filter(p=>Number(p.lowStockAt)>0&&Number(p.stock)<=Number(p.lowStockAt)).length;
 $("productList").innerHTML=products.length?products.map(p=>'<article class="productrow"><div><b>'+escapeHtml(p.name)+'</b><small>SKU '+escapeHtml(p.sku)+' • '+escapeHtml(p.unit)+'</small></div><div><b>'+money(p.retailPrice)+'</b><small>Wholesale '+money(p.wholesalePrice)+'</small></div><div><b>'+p.stock+' '+escapeHtml(p.unit)+'</b><small>In stock</small></div></article>').join(""):'<p class="muted">No products yet. Add your first product.</p>';
 $("billProduct").innerHTML=products.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+' — '+money(p.retailPrice)+' • Stock '+p.stock+'</option>').join("");
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function addProduct(){
 const name=prompt("Product name");if(!name?.trim())return;
 const retailPrice=Number(prompt("Retail selling price (₹)"));if(!(retailPrice>0)){message("Enter a valid retail price.",true);return;}
 const wholesalePrice=Number(prompt("Wholesale price (₹)")||retailPrice);const openingStock=Number(prompt("Opening stock quantity")||0);
 const unit=prompt("Unit (piece, kg, gram, litre, packet, box)", "piece")||"piece";
 const sku=prompt("SKU / product code (optional)","")||"";
 await api("kiranaAddProduct")({storeId:activeStore,name,retailPrice,wholesalePrice,openingStock,unit,sku});
 message("Product saved securely to your store. Stock is ready.");await loadProducts();
}
function renderBill(){const total=bill.reduce((s,x)=>s+x.price*x.quantity,0);$("billTotal").textContent=money(total);$("billLines").innerHTML=bill.length?bill.map((x,i)=>'<div class="billrow"><span>'+escapeHtml(x.name)+' × '+x.quantity+' ('+x.priceType+')</span><b>'+money(x.price*x.quantity)+'</b><button data-remove="'+i+'" aria-label="Remove">×</button></div>').join(""):"No items added.";document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{bill.splice(Number(b.dataset.remove),1);renderBill();});}
$("signInBtn").onclick=async()=>{try{await signInWithPopup(auth,googleProvider);}catch(e){message(e.message,true);}};
$("signOutBtn").onclick=()=>signOut(auth);
$("storeSelect").onchange=async()=>{activeStore=$("storeSelect").value;$("roleLabel").textContent=stores.find(s=>s.storeId===activeStore)?.role||"—";bill=[];renderBill();await loadProducts();};
$("newStoreBtn").onclick=async()=>{const name=prompt("New store name");if(!name?.trim())return;const phone=prompt("Store mobile");if(!phone?.trim())return;await api("kiranaCreateStore")({name,phone,address:prompt("Store address")||"Not added"});await loadStores();message("New store workspace created.");};
$("addProductBtn").onclick=async()=>{try{await addProduct();}catch(e){message(e.message,true);}};
$("addLineBtn").onclick=()=>{const p=products.find(x=>x.id===$("billProduct").value);const quantity=Number($("billQty").value);if(!p||!(quantity>0)||quantity>p.stock){message("Choose a product and valid quantity within available stock.",true);return;}const priceType=$("priceType").value;bill.push({productId:p.id,name:p.name,quantity,price:priceType==="wholesale"?p.wholesalePrice:p.retailPrice,priceType});renderBill();};
$("completeBillBtn").onclick=async()=>{if(!bill.length){message("Add at least one product to the bill.",true);return;}try{const r=await api("kiranaCreateSale")({storeId:activeStore,items:bill.map(x=>({productId:x.productId,quantity:x.quantity,priceType:x.priceType})),paymentMode:$("paymentMode").value});bill=[];renderBill();await loadProducts();message("Bill "+r.data.invoiceNo+" saved. Total "+money(r.data.total)+". Stock updated.");}catch(e){message(e.message,true);}};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
onAuthStateChanged(auth,async u=>{user=u;$("userLabel").textContent=u?.displayName||u?.email||"Not signed in";$("signInBtn").hidden=!!u;$("signOutBtn").hidden=!u;if(!u){$("workspace").hidden=true;$("signedOut").hidden=false;message("Sign in to create or open your store workspace.");return;}try{message("Loading your secure store workspace…");await loadStores();message("Signed in as "+u.email+". Your store data is isolated from other stores.");}catch(e){message(e.message||"Could not load your store.",true);}});


let customers=[];
async function loadCustomers(){
 const r=await api("kiranaListCustomers")({storeId:activeStore});customers=r.data.customers||[];
 const rows=customers.map(c=>'<article class="productrow"><div><b>'+escapeHtml(c.name)+'</b><small>'+escapeHtml(c.phone||"No mobile added")+'</small></div><div><b>'+money(c.creditBalance)+'</b><small>Outstanding udhar</small></div><div><button class="outline" data-pay="'+c.id+'">Receive payment</button></div></article>');
 $("customerList").innerHTML=rows.join("")||'<p class="muted">No customers yet. Add your first customer.</p>';
 for(const id of ["creditCustomer","paymentCustomer"]){$(id).innerHTML=customers.map(c=>'<option value="'+c.id+'">'+escapeHtml(c.name)+' — Due '+money(c.creditBalance)+'</option>').join("");}
 document.querySelectorAll("[data-pay]").forEach(b=>b.onclick=()=>{$("paymentCustomer").value=b.dataset.pay;$("customerPaymentAmount").focus();});
}
$("addCustomerBtn").onclick=async()=>{try{const name=prompt("Customer name");if(!name?.trim())return;const phone=prompt("Mobile number (optional)")||"";await api("kiranaAddCustomer")({storeId:activeStore,name,phone});await loadCustomers();message("Customer saved.");}catch(e){message(e.message,true);}};
$("addCreditBtn").onclick=async()=>{try{const customerId=$("creditCustomer").value,amount=Number($("creditAmount").value),invoiceId=$("creditInvoice").value.trim();if(!customerId||!(amount>0)||!invoiceId){message("Choose customer, amount and invoice reference.",true);return;}await api("kiranaRecordCustomerCredit")({storeId:activeStore,customerId,amount,invoiceId});$("creditAmount").value="";$("creditInvoice").value="";await loadCustomers();message("Udhar entry recorded against the customer.");}catch(e){message(e.message,true);}};
$("receivePaymentBtn").onclick=async()=>{try{const customerId=$("paymentCustomer").value,amount=Number($("customerPaymentAmount").value);if(!customerId||!(amount>0)){message("Choose customer and enter payment amount.",true);return;}await api("kiranaRecordCreditPayment")({storeId:activeStore,customerId,amount,paymentMode:$("customerPaymentMode").value});$("customerPaymentAmount").value="";await loadCustomers();message("Customer payment recorded and balance updated.");}catch(e){message(e.message,true);}};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{showTab(b.dataset.tab);if(b.dataset.tab==="customers")loadCustomers().catch(e=>message(e.message,true));});

$("paymentMode").onchange=()=>{$("billCustomerWrap").hidden=$("paymentMode").value!=="credit";if($("paymentMode").value==="credit")loadCustomers().catch(e=>message(e.message,true));};
const originalCompleteBill = $("completeBillBtn").onclick;
$("completeBillBtn").onclick=async()=>{
 if($("paymentMode").value==="credit"&&!$("billCustomer").value){message("Udhar bill ke liye customer select karein.",true);return;}
 if(!bill.length){message("Add at least one product to the bill.",true);return;}
 try{
  const payload={storeId:activeStore,items:bill.map(x=>({productId:x.productId,quantity:x.quantity,priceType:x.priceType})),paymentMode:$("paymentMode").value};
  if(payload.paymentMode==="credit")payload.customerId=$("billCustomer").value;
  const r=await api("kiranaCreateSale")(payload);
  bill=[];renderBill();await loadProducts();if(payload.paymentMode==="credit")await loadCustomers();
  message("Bill "+r.data.invoiceNo+" saved. Total "+money(r.data.total)+(payload.paymentMode==="credit"?" customer udhar ledger mein add ho gaya.":" Stock updated."));
 }catch(e){message(e.message,true);}
};
const priorTabHandlers = document.querySelectorAll(".tab");
priorTabHandlers.forEach(b=>b.addEventListener("click",()=>{if(b.dataset.tab==="billing"&&$("paymentMode").value==="credit")loadCustomers().catch(e=>message(e.message,true));}));
