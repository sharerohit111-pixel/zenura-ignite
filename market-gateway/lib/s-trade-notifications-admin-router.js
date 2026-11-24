"use strict";

const {normalizePriceAlert,normalizePreferences,safeAdminReason,isProvider}=require("./s-trade-notifications-admin");

function createSTradeRouter({express,serviceDb,authenticate,resolvePriceAlertInstrument}){
  if(!express||!serviceDb||typeof authenticate!=="function")throw new TypeError("S-TRADE router dependencies are required");
  const router=express.Router();
  const fail=(res,error,message)=>res.status(Number.isInteger(error?.status)?error.status:503).json({error:error?.status?error.message:message});
  async function signedIn(req){return authenticate(req);}
  async function requireAdmin(req){
    const session=await signedIn(req);
    const result=await serviceDb.from("s_trade_admins").select("user_id").eq("user_id",session.user.id).maybeSingle();
    if(result?.error)throw Object.assign(new Error("Admin authorization could not be verified."),{status:503});
    if(!result?.data)throw Object.assign(new Error("Administrator access required."),{status:403});
    return session;
  }
  async function audit(actor,action,targetType,targetId,reason,outcome,metadata={}){
    const result=await serviceDb.from("s_trade_admin_audit_log").insert({
      actor_user_id:actor,action,target_type:targetType,target_id:targetId||null,
      reason,outcome,metadata
    });
    if(result?.error)throw Object.assign(new Error("Administrative audit record could not be written."),{status:503});
  }

  router.get("/notifications",async(req,res)=>{
    try{
      const {user}=await signedIn(req);
      const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit||"50",10)||50));
      const result=await serviceDb.from("s_trade_notifications")
        .select("notification_id,event_type,title,body,data,created_at,read_at")
        .eq("user_id",user.id).order("created_at",{ascending:false}).limit(limit);
      if(result.error)throw Object.assign(new Error("Notifications could not be loaded."),{status:503});
      res.set("Cache-Control","private, no-store").json({notifications:result.data||[]});
    }catch(error){fail(res,error,"Notifications could not be loaded.");}
  });

  router.post("/notifications/:id/read",async(req,res)=>{
    try{
      const {user}=await signedIn(req);
      const result=await serviceDb.from("s_trade_notifications").update({read_at:new Date().toISOString()})
        .eq("notification_id",req.params.id).eq("user_id",user.id).is("read_at",null)
        .select("notification_id").maybeSingle();
      if(result.error)throw Object.assign(new Error("Notification state could not be updated."),{status:503});
      if(!result.data)return res.status(404).json({error:"Notification not found."});
      res.set("Cache-Control","no-store").json({read:true});
    }catch(error){fail(res,error,"Notification state could not be updated.");}
  });

  router.get("/preferences",async(req,res)=>{
    try{
      const {user}=await signedIn(req);
      const result=await serviceDb.from("s_trade_notification_preferences").select("*").eq("user_id",user.id).maybeSingle();
      if(result.error)throw Object.assign(new Error("Notification preferences could not be loaded."),{status:503});
      res.set("Cache-Control","private, no-store").json({preferences:result.data||{
        trade_confirmations:true,order_alerts:true,price_alerts:true,security_alerts:true,email_enabled:false,push_enabled:false
      }});
    }catch(error){fail(res,error,"Notification preferences could not be loaded.");}
  });

  router.put("/preferences",async(req,res)=>{
    try{
      const {user}=await signedIn(req),patch=normalizePreferences(req.body);
      if(!Object.keys(patch).length)return res.status(400).json({error:"At least one preference is required."});
      const result=await serviceDb.from("s_trade_notification_preferences")
        .upsert({user_id:user.id,...patch,updated_at:new Date().toISOString()},{onConflict:"user_id"})
        .select("*").single();
      if(result.error)throw Object.assign(new Error("Notification preferences could not be saved."),{status:503});
      res.set("Cache-Control","no-store").json({preferences:result.data});
    }catch(error){fail(res,error,"Notification preferences could not be saved.");}
  });

  router.get("/price-alerts",async(req,res)=>{
    try{
      const {user}=await signedIn(req);
      const result=await serviceDb.from("s_trade_price_alerts")
        .select("alert_id,instrument_key,display_symbol,condition,target_price,active,triggered_at,last_observed_price,created_at")
        .eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
      if(result.error)throw Object.assign(new Error("Price alerts could not be loaded."),{status:503});
      res.set("Cache-Control","private, no-store").json({alerts:result.data||[]});
    }catch(error){fail(res,error,"Price alerts could not be loaded.");}
  });

  router.post("/price-alerts",async(req,res)=>{
    try{
      const {user}=await signedIn(req),alert=normalizePriceAlert(req.body);
      const count=await serviceDb.from("s_trade_price_alerts").select("alert_id",{count:"exact",head:true})
        .eq("user_id",user.id).eq("active",true);
      if(count.error)throw Object.assign(new Error("Price alert quota could not be checked."),{status:503});
      if((count.count||0)>=50)return res.status(429).json({error:"Maximum 50 active price alerts per account."});
      const result=await serviceDb.from("s_trade_price_alerts").insert({user_id:user.id,...alert})
        .select("alert_id,instrument_key,display_symbol,condition,target_price,active,created_at").single();
      if(result.error)throw Object.assign(new Error("Price alert could not be created."),{status:503});
      res.status(201).set("Cache-Control","no-store").json({alert:result.data});
    }catch(error){fail(res,error,"Price alert could not be created.");}
  });

  router.delete("/price-alerts/:id",async(req,res)=>{
    try{
      const {user}=await signedIn(req);
      const result=await serviceDb.from("s_trade_price_alerts").delete()
        .eq("alert_id",req.params.id).eq("user_id",user.id).select("alert_id").maybeSingle();
      if(result.error)throw Object.assign(new Error("Price alert could not be deleted."),{status:503});
      if(!result.data)return res.status(404).json({error:"Price alert not found."});
      res.set("Cache-Control","no-store").json({deleted:true});
    }catch(error){fail(res,error,"Price alert could not be deleted.");}
  });

  router.get("/admin/overview",async(req,res)=>{
    try{
      await requireAdmin(req);
      const [users,alerts,notifications,providers,controls]=await Promise.all([
        serviceDb.auth.admin.listUsers({page:1,perPage:1}),
        serviceDb.from("s_trade_price_alerts").select("alert_id",{count:"exact",head:true}).eq("active",true),
        serviceDb.from("s_trade_notifications").select("notification_id",{count:"exact",head:true}).is("read_at",null),
        serviceDb.from("s_trade_provider_health").select("provider,status,latency_ms,last_success_at,last_failure_at,consecutive_failures,safe_message,checked_at"),
        serviceDb.from("s_trade_operational_controls").select("control_key,enabled,reason,updated_at")
      ]);
      if(users.error||alerts.error||notifications.error||providers.error||controls.error)
        throw Object.assign(new Error("Admin overview is temporarily unavailable."),{status:503});
      res.set("Cache-Control","private, no-store").json({
        userDirectoryAvailable:true,
        activePriceAlerts:alerts.count||0,unreadNotifications:notifications.count||0,
        providers:providers.data||[],controls:controls.data||[]
      });
    }catch(error){fail(res,error,"Admin overview is temporarily unavailable.");}
  });

  router.get("/admin/users",async(req,res)=>{
    try{
      await requireAdmin(req);
      const page=Math.min(1000,Math.max(1,Number.parseInt(req.query.page||"1",10)||1));
      const result=await serviceDb.auth.admin.listUsers({page,perPage:50});
      if(result.error)throw Object.assign(new Error("User directory could not be loaded."),{status:503});
      const users=(result.data?.users||[]).map(user=>({
        id:user.id,email:user.email||null,createdAt:user.created_at||null,
        lastSignInAt:user.last_sign_in_at||null,emailConfirmed:!!user.email_confirmed_at,
        bannedUntil:user.banned_until||null
      }));
      res.set("Cache-Control","private, no-store").json({users,page,perPage:50});
    }catch(error){fail(res,error,"User directory could not be loaded.");}
  });

  router.post("/admin/users/:id/status",async(req,res)=>{
    let actor=null,reason=null;
    try{
      const session=await requireAdmin(req);actor=session.user.id;
      const target=req.params.id,disabled=req.body?.disabled;
      reason=safeAdminReason(req.body?.reason);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target)
        ||typeof disabled!=="boolean"||!reason)return res.status(400).json({error:"A valid user UUID, disabled boolean and reason are required."});
      if(target===actor)return res.status(400).json({error:"Administrators cannot suspend their own account."});
      await audit(actor,disabled?"user_suspend":"user_restore","user",target,reason,"requested");
      const result=await serviceDb.auth.admin.updateUserById(target,{ban_duration:disabled?"876000h":"none"});
      if(result.error){
        await audit(actor,disabled?"user_suspend":"user_restore","user",target,reason,"failed",{code:result.error.code||"unknown"});
        throw Object.assign(new Error("User status could not be changed."),{status:503});
      }
      await audit(actor,disabled?"user_suspend":"user_restore","user",target,reason,"succeeded");
      res.set("Cache-Control","no-store").json({updated:true,userId:target,disabled});
    }catch(error){if(actor&&reason){/* failed authorization and validation are not elevated to admin actions */}fail(res,error,"User status could not be changed.");}
  });

  router.get("/admin/providers",async(req,res)=>{
    try{
      await requireAdmin(req);
      const result=await serviceDb.from("s_trade_provider_health").select("*").order("provider");
      if(result.error)throw Object.assign(new Error("Provider status could not be loaded."),{status:503});
      res.set("Cache-Control","private, no-store").json({providers:result.data||[]});
    }catch(error){fail(res,error,"Provider status could not be loaded.");}
  });

  router.get("/admin/audit",async(req,res)=>{
    try{
      await requireAdmin(req);
      const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit||"50",10)||50));
      const result=await serviceDb.from("s_trade_admin_audit_log").select("*").order("created_at",{ascending:false}).limit(limit);
      if(result.error)throw Object.assign(new Error("Admin audit log could not be loaded."),{status:503});
      res.set("Cache-Control","private, no-store").json({events:result.data||[]});
    }catch(error){fail(res,error,"Admin audit log could not be loaded.");}
  });

  router.post("/admin/controls/:key",async(req,res)=>{
    let actor=null,reason=null;
    try{
      const session=await requireAdmin(req);actor=session.user.id;
      const key=req.params.key,enabled=req.body?.enabled;
      reason=safeAdminReason(req.body?.reason);
      if(!["new_orders_enabled","price_alerts_enabled","provider_upstox_enabled"].includes(key)
        ||typeof enabled!=="boolean"||!reason)return res.status(400).json({error:"Unsupported control, boolean state and reason are required."});
      await audit(actor,"operational_control","control",key,reason,"requested",{enabled});
      const result=await serviceDb.from("s_trade_operational_controls")
        .upsert({control_key:key,enabled,reason,updated_by:actor,updated_at:new Date().toISOString()},{onConflict:"control_key"});
      if(result.error){
        await audit(actor,"operational_control","control",key,reason,"failed",{enabled});
        throw Object.assign(new Error("Operational control could not be updated."),{status:503});
      }
      await audit(actor,"operational_control","control",key,reason,"succeeded",{enabled});
      res.set("Cache-Control","no-store").json({updated:true,key,enabled});
    }catch(error){fail(res,error,"Operational control could not be updated.");}
  });

  return router;
}
module.exports={createSTradeRouter};
