"use strict";
const crypto=require("node:crypto");
const fs=require("node:fs/promises");
const path=require("node:path");
const EXPORT_COLLECTIONS=Object.freeze(["customerProfiles","users","indianPaperAccounts","indianPaperOrders","indianDerivativeOrders","indianMarketWatchlists"]);
const EXCLUDED_COLLECTIONS=Object.freeze(["upstoxConnections (encrypted broker-token envelopes)","upstoxOAuthStates","upstoxConnectionControls","indianMarketStreamLeases","indianMarketWorkerState","indianMarginPreviewLimits","paymentOrders","razorpayEvents"]);
function serializeFirestoreValue(value){
 if(value===undefined||value===null)return null;
 if(Buffer.isBuffer(value))return {__type:"bytes",base64:value.toString("base64")};
 if(value instanceof Date)return {__type:"date",iso:value.toISOString()};
 if(typeof value!=="object"){if(typeof value==="bigint")return {__type:"bigint",decimal:value.toString()};return value;}
 if(Array.isArray(value))return value.map(serializeFirestoreValue);
 if(typeof value.path==="string"&&value.firestore&&value.id)return {__type:"document_reference",path:value.path};
 if(Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&value.constructor?.name==="GeoPoint")return {__type:"geopoint",latitude:value.latitude,longitude:value.longitude};
 if(Number.isInteger(value._seconds)&&Number.isInteger(value._nanoseconds))return {__type:"timestamp",seconds:value._seconds,nanoseconds:value._nanoseconds};
 if(typeof value.toDate==="function"&&typeof value.toMillis==="function"){
  const millis=value.toMillis();return {__type:"timestamp",seconds:Math.floor(millis/1000),nanoseconds:Math.floor((millis%1000)*1e6)};
 }
 const result={};for(const [key,item] of Object.entries(value))result[key]=serializeFirestoreValue(item);return result;
}
function sanitizeAuthUser(user){
 return {uid:user.uid,email:user.email||null,emailVerified:user.emailVerified===true,displayName:user.displayName||null,
  disabled:user.disabled===true,photoURL:user.photoURL||null,phoneNumber:user.phoneNumber||null,
  metadata:{creationTime:user.metadata?.creationTime||null,lastSignInTime:user.metadata?.lastSignInTime||null},
  providerData:(user.providerData||[]).map(p=>({providerId:p.providerId||null,uid:p.uid||null,email:p.email||null,displayName:p.displayName||null}))};
}
async function writeJsonlFile(filePath,records){
 const handle=await fs.open(filePath,"wx",0o600),hash=crypto.createHash("sha256");let count=0;
 try{for await(const record of records){const line=JSON.stringify(record)+"\n";await handle.write(line);hash.update(line);count++;}await handle.sync();}
 catch(error){await handle.close();throw error;}
 await handle.close();return {count,sha256:hash.digest("hex"),file:path.basename(filePath)};
}
async function* firestoreDocuments(db,collectionName,pageSize=400){
 let cursor=null;
 while(true){
  let query=db.collection(collectionName).orderBy("__name__").limit(pageSize);
  if(cursor)query=query.startAfter(cursor);
  const snapshot=await query.get();if(!snapshot.docs.length)return;
  for(const document of snapshot.docs)yield {collection:collectionName,documentId:document.id,path:document.ref?.path||collectionName+"/"+document.id,data:serializeFirestoreValue(document.data())};
  cursor=snapshot.docs[snapshot.docs.length-1];if(snapshot.docs.length<pageSize)return;
 }
}
async function* authUsers(auth,pageSize=1000){
 let pageToken;do{const page=await auth.listUsers(pageSize,pageToken);for(const user of page.users)yield sanitizeAuthUser(user);pageToken=page.pageToken;}while(pageToken);
}
async function exportSnapshot({db,auth,outputDirectory,projectId,pageSize=400}){
 if(!db||!auth||typeof outputDirectory!=="string"||!outputDirectory||typeof projectId!=="string"||!projectId||!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new TypeError("Export dependencies, project ID, output directory or page size are invalid.");
 const target=path.resolve(outputDirectory);await fs.mkdir(target,{recursive:false,mode:0o700});const files={};
 for(const name of EXPORT_COLLECTIONS)files[name+".jsonl"]=await writeJsonlFile(path.join(target,name+".jsonl"),firestoreDocuments(db,name,pageSize));
 files["firebase-auth-users.jsonl"]=await writeJsonlFile(path.join(target,"firebase-auth-users.jsonl"),authUsers(auth));
 const manifest={format:"zenura-firebase-read-only-export-v1",projectId,exportedAt:new Date().toISOString(),mode:"read-only",
  pagination:{firestorePageSize:pageSize,order:"document-name-ascending"},collections:EXPORT_COLLECTIONS,excludedCollections:EXCLUDED_COLLECTIONS,files,
  totals:{firestoreDocuments:Object.values(files).filter(x=>x.file!=="firebase-auth-users.jsonl").reduce((s,x)=>s+x.count,0),authUsers:files["firebase-auth-users.jsonl"].count},
  importPerformed:false,sourceMutated:false};
 await fs.writeFile(path.join(target,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{encoding:"utf8",flag:"wx",mode:0o600});return manifest;
}
function parseArgs(argv){
 const args={confirm:false,outputDirectory:null,pageSize:400,dryRun:true};
 for(let i=0;i<argv.length;i++){const v=argv[i];if(v==="--confirm-read-only-export")args.confirm=true;else if(v==="--out-dir")args.outputDirectory=argv[++i]||null;else if(v==="--page-size")args.pageSize=Number(argv[++i]);else if(v==="--help"||v==="-h")args.help=true;else throw new Error("Unknown argument: "+v);}
 args.dryRun=!args.confirm;return args;
}
async function main(argv=process.argv.slice(2)){
 const args=parseArgs(argv);
 if(args.help){process.stdout.write("Read-only Firebase export. Dry run: node scripts/firebase-readonly-export.js\nExport: node scripts/firebase-readonly-export.js --confirm-read-only-export --out-dir <new-directory>\n");return;}
 if(args.dryRun){process.stdout.write(JSON.stringify({mode:"dry-run",collections:EXPORT_COLLECTIONS,excludedCollections:EXCLUDED_COLLECTIONS,writesToFirebase:false,importPerformed:false,instruction:"Pass --confirm-read-only-export and --out-dir for local export."},null,2)+"\n");return;}
 if(!args.outputDirectory)throw new Error("--out-dir is required for an export.");
 if(!Number.isInteger(args.pageSize)||args.pageSize<1||args.pageSize>1000)throw new Error("--page-size must be an integer from 1 through 1000.");
 const projectId=process.env.FIREBASE_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT;
 if(!projectId)throw new Error("Set FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT explicitly.");
 const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
 const {getFirestore}=require("firebase-admin/firestore");
 const {getAuth}=require("firebase-admin/auth");
 if(!getApps().length)initializeApp({credential:applicationDefault(),projectId});
 const manifest=await exportSnapshot({db:getFirestore(),auth:getAuth(),outputDirectory:args.outputDirectory,projectId,pageSize:args.pageSize});
 process.stdout.write(JSON.stringify({mode:"read-only-export-complete",outputDirectory:path.resolve(args.outputDirectory),totals:manifest.totals,importPerformed:false,sourceMutated:false},null,2)+"\n");
}
if(require.main===module)main().catch(error=>{process.stderr.write("Firebase export failed: "+error.message+"\n");process.exitCode=1;});
module.exports={EXPORT_COLLECTIONS,EXCLUDED_COLLECTIONS,serializeFirestoreValue,sanitizeAuthUser,firestoreDocuments,authUsers,exportSnapshot,parseArgs};
