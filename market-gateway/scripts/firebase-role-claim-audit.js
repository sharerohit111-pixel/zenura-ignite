"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
async function auditFirebaseRoleClaims({auth,projectId,pageSize=1000}={}){
 if(!auth||typeof auth.listUsers!=="function")throw new TypeError("Firebase Auth listUsers is required.");
 if(typeof projectId!=="string"||!projectId.trim())throw new TypeError("An explicit Firebase project ID is required.");
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new TypeError("Page size must be 1..1000.");
 const totals={users:0,enabledUsers:0,disabledUsers:0,roleAuthenticated:0,roleMissing:0,roleUnexpected:0};
 let pageToken=null,pages=0;
 const seenPageTokens=new Set();
 do{
  const page=await auth.listUsers(pageSize,pageToken||undefined);
  if(!page||!Array.isArray(page.users))throw new Error("Firebase Auth returned an invalid user page.");
  pages++;
  for(const user of page.users){
   totals.users++;
   if(user.disabled===true)totals.disabledUsers++;else totals.enabledUsers++;
   const claims=user.customClaims&&typeof user.customClaims==="object"&&!Array.isArray(user.customClaims)?user.customClaims:{};
   if(!Object.prototype.hasOwnProperty.call(claims,"role"))totals.roleMissing++;
   else if(claims.role==="authenticated")totals.roleAuthenticated++;
   else totals.roleUnexpected++;
  }
  pageToken=page.pageToken||null;
  if(pageToken){if(seenPageTokens.has(pageToken))throw new Error("Firebase Auth repeated a pagination token.");seenPageTokens.add(pageToken);}
 }while(pageToken);
 return Object.freeze({format:"zenura-firebase-role-claim-audit-v1",projectId,auditedAt:new Date().toISOString(),pages,totals:Object.freeze(totals),sourceMutated:false,customClaimsChanged:false,userIdentifiersCollected:false});
}
function parseArgs(argv){
 const args={confirm:false,outputDirectory:null,pageSize:1000,help:false};
 for(let i=0;i<argv.length;i++){const value=argv[i];if(value==="--confirm-read-only-audit")args.confirm=true;else if(value==="--out-dir")args.outputDirectory=argv[++i]||null;else if(value==="--page-size")args.pageSize=Number(argv[++i]);else if(value==="--help"||value==="-h")args.help=true;else throw new Error("Unknown argument: "+value);}
 return args;
}
async function main(argv=process.argv.slice(2)){
 const args=parseArgs(argv);
 if(args.help){process.stdout.write("Firebase role claim audit (aggregate counts only; no user identifiers or claim values).\nDry run: node scripts/firebase-role-claim-audit.js\nAudit: FIREBASE_PROJECT_ID=<project> node scripts/firebase-role-claim-audit.js --confirm-read-only-audit --out-dir <new-private-directory>\n");return;}
 if(!args.confirm){process.stdout.write(JSON.stringify({mode:"dry-run",firebaseReads:false,sourceMutated:false,customClaimsChanged:false,instruction:"Set FIREBASE_PROJECT_ID and pass --confirm-read-only-audit --out-dir <new-private-directory> to run the read-only count audit."},null,2)+"\n");return;}
 if(!args.outputDirectory)throw new Error("--out-dir is required for a confirmed audit.");
 if(!Number.isInteger(args.pageSize)||args.pageSize<1||args.pageSize>1000)throw new Error("--page-size must be an integer from 1 through 1000.");
 const projectId=process.env.FIREBASE_PROJECT_ID;
 if(typeof projectId!=="string"||!projectId.trim())throw new Error("Set FIREBASE_PROJECT_ID explicitly; ambient Google project variables are not accepted.");
 const target=path.resolve(args.outputDirectory);
 await fs.mkdir(target,{recursive:false,mode:0o700});
 try{
  const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
  const {getAuth}=require("firebase-admin/auth");
  if(!getApps().length)initializeApp({credential:applicationDefault(),projectId});
  const report=await auditFirebaseRoleClaims({auth:getAuth(),projectId,pageSize:args.pageSize});
  await fs.writeFile(path.join(target,"role-claim-audit.json"),JSON.stringify(report,null,2)+"\n",{encoding:"utf8",flag:"wx",mode:0o600});
  process.stdout.write(JSON.stringify({mode:"read-only-audit-complete",outputDirectory:target,totals:report.totals,sourceMutated:false,customClaimsChanged:false,userIdentifiersCollected:false},null,2)+"\n");
 }catch{throw new Error("Firebase role claim audit failed. Check Firebase Admin SDK setup and read-only credentials; sensitive provider error details were suppressed.");}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+"\n");process.exitCode=1;});
module.exports={auditFirebaseRoleClaims,parseArgs};
