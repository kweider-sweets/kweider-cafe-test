import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:3,idle_timeout:20,connect_timeout:8});
const BASE="https://zybamugtuzootaovodut.supabase.co";
const APIKEY="sb_publishable_SX6WfHESZNGHaXnXN7_fCQ_DcXVmMsx";
const ALLOWED=new Set([BASE,"https://staff.kweidersweets.co.uk","https://kweidersweets.co.uk","https://menu.kweidersweets.co.uk"]);
const timeRE=/^(?:[01]\d|2[0-3]):[0-5]\d$/,dateRE=/^\d{4}-\d{2}-\d{2}$/,uuidRE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(v:unknown,max=300)=>String(v??"").trim().slice(0,max);
const json=(body:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Origin":origin&&ALLOWED.has(origin)?origin:BASE,"Access-Control-Allow-Headers":"authorization,content-type,apikey","Access-Control-Allow-Methods":"POST,OPTIONS"}});
async function staffFromToken(token:string){
 if(!token||token.length>6000)throw Error("AUTH_REQUIRED");
 const r=await fetch(BASE+"/auth/v1/user",{headers:{apikey:APIKEY,Authorization:"Bearer "+token},signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw Error("AUTH_REQUIRED");
 const user=await r.json();if(!uuidRE.test(String(user?.id||"")))throw Error("AUTH_REQUIRED");
 const roles=await sql.unsafe("SELECT p.user_id,p.display_name,p.role,p.active,EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=p.user_id AND f.status='verified') AS mfa_enabled FROM booking.staff_profiles p WHERE p.user_id=$1::uuid LIMIT 1",[user.id]);
 const staff=roles[0];if(!staff?.active||!["manager","employee"].includes(staff.role))throw Error("STAFF_ACCESS_DENIED");
 // A previously verified MFA factor requires an AAL2 session. No factor = normal login until enrolled.
 if(staff.mfa_enabled){
  let aal="aal1";
  try{
   const part=token.split(".")[1]||"";
   const padded=part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"=");
   aal=String(JSON.parse(atob(padded))?.aal||"aal1");
  }catch{throw Error("MFA_REQUIRED")}
  if(aal!=="aal2")throw Error("MFA_REQUIRED");
 }
 return {id:String(user.id),email:String(user.email||""),name:staff.display_name||String(user.email||""),role:String(staff.role),mfa_enabled:Boolean(staff.mfa_enabled)};
}
function requireEdit(staff:any){if(staff.role!=="manager")throw Error("PERMISSION_DENIED");}
async function audit(tx:any,staff:any,action:string,type:string,id:string,old:any,next:any){
 await tx.unsafe("INSERT INTO booking.staff_audit(actor_id,action,target_type,target_id,old_value,new_value) VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6::jsonb)",
 [staff.id,action,type,id,JSON.stringify(old??null),JSON.stringify(next??null)]);
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&!ALLOWED.has(origin))return json({ok:false,error:"ORIGIN_BLOCKED"},403,origin);
 if(req.method==="OPTIONS")return json({ok:true},200,origin);
 if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405,origin);
 const len=Number(req.headers.get("content-length")||0);
 if(len>16000)return json({ok:false,error:"PAYLOAD_TOO_LARGE"},413,origin);
 let body:any;
 try{body=await req.json()}catch{return json({ok:false,error:"INVALID_JSON"},400,origin)}
 const action=clean(body?.action,30);
 try{
  if(action==="register"){
   const email=clean(body.email,250).toLowerCase(),password=String(body.password||"");
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<12||password.length>200)
    return json({ok:false,error:"INVALID_REGISTRATION"},400,origin);
   const invited=await sql.unsafe("SELECT email FROM booking.staff_invites WHERE email=$1 AND active=true AND claimed_by IS NULL LIMIT 1",[email]);
   if(invited.length!==1)return json({ok:false,error:"INVITATION_REQUIRED"},403,origin);
   const signup=await fetch(BASE+"/auth/v1/signup",{method:"POST",headers:{"Content-Type":"application/json",apikey:APIKEY},
    body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
   const outcome=await signup.json().catch(()=>({}));
   if(!signup.ok)return json({ok:false,error:"SIGNUP_UNAVAILABLE",details:clean(outcome?.msg||outcome?.error_description||"",110)},400,origin);
   // No privilege is granted here: activation requires verified ownership of the invited email.
   return json({ok:true,requires_email_verification:true,message:"Check your inbox to verify the email address. Then sign in."},200,origin);
  }
  if(action==="activate"){
   const token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
   if(!token)return json({ok:false,error:"AUTH_REQUIRED"},401,origin);
   const resp=await fetch(BASE+"/auth/v1/user",{headers:{apikey:APIKEY,Authorization:"Bearer "+token},signal:AbortSignal.timeout(7000)});
   if(!resp.ok)return json({ok:false,error:"AUTH_REQUIRED"},401,origin);
   const authUser=await resp.json(),id=String(authUser?.id||""),email=clean(authUser?.email,250).toLowerCase();
   if(!uuidRE.test(id)||!email||!authUser.email_confirmed_at)return json({ok:false,error:"EMAIL_VERIFICATION_REQUIRED"},403,origin);
   const activated=await sql.begin(async tx=>{
    const invite=await tx.unsafe("SELECT email,role,display_name,claimed_by FROM booking.staff_invites WHERE email=$1 AND active=true FOR UPDATE",[email]);
    const v=invite[0];
    if(!v||(v.claimed_by&&String(v.claimed_by)!==id))throw Error("INVITATION_NOT_VALID");
    const assigned=await tx.unsafe("SELECT user_id FROM booking.staff_profiles WHERE user_id=$1::uuid FOR UPDATE",[id]);
    if(assigned.length===0)await tx.unsafe("INSERT INTO booking.staff_profiles(user_id,role,display_name,active) VALUES($1::uuid,$2,$3,true)",[id,v.role,v.display_name]);
    else await tx.unsafe("UPDATE booking.staff_profiles SET active=true,role=$2,display_name=$3,updated_at=now() WHERE user_id=$1::uuid",[id,v.role,v.display_name]);
    await tx.unsafe("UPDATE booking.staff_invites SET claimed_at=coalesce(claimed_at,now()),claimed_by=$2::uuid WHERE email=$1",[email,id]);
    return true;
   });
   return json({ok:activated,activated:true},200,origin);
  }
  if(action==="login"){
   const email=clean(body.email,250),password=String(body.password||"");
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<8||password.length>200)return json({ok:false,error:"INVALID_CREDENTIALS"},401,origin);
   const auth=await fetch(BASE+"/auth/v1/token?grant_type=password",{method:"POST",headers:{"Content-Type":"application/json",apikey:APIKEY},
    body:JSON.stringify({email,password}),signal:AbortSignal.timeout(9000)});
   if(!auth.ok)return json({ok:false,error:"INVALID_CREDENTIALS"},401,origin);
   const tokens=await auth.json();
   let user;
   try {user=await staffFromToken(String(tokens.access_token||""));}
   catch(error){
     const reason=String(error instanceof Error?error.message:error);
     if(reason==="STAFF_ACCESS_DENIED")return json({ok:false,error:"ACCOUNT_NOT_ACTIVATED",access_token:tokens.access_token},403,origin);
     if(reason==="MFA_REQUIRED")return json({ok:true,mfa_required:true,access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_in:tokens.expires_in},200,origin);
     throw error;
   }
   return json({ok:true,access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_in:tokens.expires_in,staff:user},200,origin);
  }
  const token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
  const staff=await staffFromToken(token);
  if(action==="me")return json({ok:true,staff},200,origin);

  if(action==="calendar"){
   const month=clean(body.month,7);
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("INVALID_MONTH");
   const [days,nowRows]=await Promise.all([
     sql.unsafe("SELECT (start_at AT TIME ZONE 'Europe/London')::date::text AS day,count(*)::int AS bookings,coalesce(sum(guests),0)::int AS guests FROM booking.bookings WHERE status='CONFIRMED' AND start_at >= ($1::date AT TIME ZONE 'Europe/London') AND start_at < (($1::date + interval '1 month') AT TIME ZONE 'Europe/London') GROUP BY 1 ORDER BY 1",[month+"-01"]),
     sql.unsafe("SELECT now() AS server_utc,to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD HH24:MI') AS london_now")
   ]);
   return json({ok:true,month,days,london_now:nowRows[0]?.london_now||null,server_utc:nowRows[0]?.server_utc||null},200,origin);
  }
  if(action==="monitor"){
   const [recent,upcoming,clock,notes]=await Promise.all([
    sql.unsafe("SELECT id::text AS id,reference,customer_name,guests,start_at,created_at FROM booking.bookings WHERE status='CONFIRMED' AND created_at >= now()-interval '7 days' AND start_at >= now()-interval '2 hours' ORDER BY created_at DESC,id DESC LIMIT 100"),
    sql.unsafe("SELECT id::text AS id,reference,customer_name,guests,start_at FROM booking.bookings WHERE status='CONFIRMED' AND start_at >= now()-interval '1 hour' AND start_at < now()+interval '24 hours' ORDER BY start_at ASC LIMIT 30"),
    sql.unsafe("SELECT now() AS server_utc,to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD HH24:MI') AS london_now"),
    sql.unsafe("SELECT n.id::text AS id,n.note_day::text AS day,n.author_id::text AS author_id,n.author_name,n.priority,n.created_at,EXISTS (SELECT 1 FROM booking.staff_note_acknowledgements ack WHERE ack.note_id=n.id AND ack.user_id=$1::uuid) AS acknowledged FROM booking.staff_day_notes n WHERE n.created_at>now()-interval '30 days' ORDER BY n.id DESC LIMIT 100",[staff.id])
   ]);
   return json({ok:true,staff_role:staff.role,staff_id:staff.id,recent,upcoming,notes,london_now:clock[0]?.london_now||null,server_utc:clock[0]?.server_utc||null},200,origin);
  }


  if(action==="list_events"){
   const month=clean(body.month,7);
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("INVALID_MONTH");
   const base="SELECT id::text AS id,event_date::text AS date,to_char(starts_at,'HH24:MI') AS start,to_char(ends_at,'HH24:MI') AS end,kind,status,title_en,title_ar,message_en,message_ar,cta_en,cta_ar,booking_url,block_regular_booking,guest_count,order_details,setup_notes,image_path,created_at,updated_at FROM booking.special_events WHERE event_date >= $1::date AND event_date < ($1::date + interval '1 month') ";
   const filter=staff.role==="manager"?"AND status <> 'CANCELLED' ":"AND status = 'PUBLISHED' ";
   const rows=await sql.unsafe(base+filter+"ORDER BY event_date,starts_at,id",[month+"-01"]);
   return json({ok:true,month,events:rows},200,origin);
  }
  if(action==="save_event"){
   requireEdit(staff);
   const id=clean(body.id,60),date=clean(body.date,10),start=clean(body.start,5),end=clean(body.end,5),
    kind=clean(body.kind,12),status=clean(body.status,12),
    titleEn=clean(body.title_en,140),titleAr=clean(body.title_ar,140),
    msgEn=clean(body.message_en,900),msgAr=clean(body.message_ar,900),
    ctaEn=clean(body.cta_en,80)||"Book now",ctaAr=clean(body.cta_ar,80)||"احجز الآن",
    url=clean(body.booking_url,500)||null,block=body.block_regular_booking===true,
    guests=body.guest_count==null||body.guest_count===''?null:Number(body.guest_count),
    orders=clean(body.order_details,4000),setup=clean(body.setup_notes,2000);
   if(id&&!uuidRE.test(id))throw Error("INVALID_EVENT_ID");
   if(guests!==null&&(!Number.isInteger(guests)||guests<1||guests>200))throw Error("INVALID_EVENT_GUEST_COUNT");
   if(!dateRE.test(date)||!timeRE.test(start)||!timeRE.test(end)||end<=start||
     !["PRIVATE","TARAB"].includes(kind)||!["DRAFT","PUBLISHED"].includes(status)||
     titleEn.length<2||titleAr.length<2||msgEn.length<5||msgAr.length<5)
     throw Error("INVALID_EVENT_INPUT");
   if(date<new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()))throw Error("PAST_EVENT_DATE");
   
   if(status==="PUBLISHED"&&kind==="TARAB"&&!url)throw Error("EVENT_BOOKING_LINK_REQUIRED");
   if(url){
    let parsed:URL;try{parsed=new URL(url)}catch{throw Error("INVALID_EVENT_BOOKING_LINK")}
    if(parsed.protocol!=="https:"||parsed.hostname!=="events.kweidersweets.co.uk"||parsed.username||parsed.password)
      throw Error("UNTRUSTED_EVENT_BOOKING_LINK");
   }
   const result=await sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(2026110501)");
    const prior=id?await tx.unsafe("SELECT * FROM booking.special_events WHERE id=$1::uuid FOR UPDATE",[id]):[];
    if(id&&!prior.length)throw Error("EVENT_NOT_FOUND");
    const old=prior[0]||null;
    const needsBlock=status==="PUBLISHED"&&block; const needsBuffer=status==="PUBLISHED";
    const bounds=await tx.unsafe("SELECT (($1::date+$2::time) AT TIME ZONE 'Europe/London') AS a,(($1::date+$3::time) AT TIME ZONE 'Europe/London') AS b",[date,start,end]);
    const a=bounds[0].a,b=bounds[0].b; const cleanEnd=new Date(new Date(b).getTime()+30*60000);
    const inWindow=(needsBlock||needsBuffer)?await tx.unsafe(
     "SELECT count(*)::integer AS n,coalesce(sum(guests),0)::integer AS covers FROM booking.bookings WHERE status='CONFIRMED' AND start_at < $2::timestamptz AND end_at > $1::timestamptz",[a,b]):[];
    const bufConflicts=needsBuffer?await tx.unsafe("SELECT count(*)::integer AS n FROM booking.bookings WHERE status='CONFIRMED' AND start_at < $2::timestamptz AND end_at > $1::timestamptz",[b,cleanEnd]):[];
    const conflicts=needsBlock?Number(inWindow[0]?.n||0):0,cleaningConflicts=Number(bufConflicts[0]?.n||0);
    if((conflicts>0||cleaningConflicts>0)&&!body.ack_existing)return {requires_ack:true,confirmed_bookings:conflicts,cleaning_conflicts:cleaningConflicts,confirmed_covers:Number(inWindow[0]?.covers||0)};
    let override=old?.capacity_override_id||null,cleanupOverride=old?.post_event_buffer_override_id||null;
    if(needsBlock){
      if(override)await tx.unsafe("UPDATE booking.capacity_overrides SET start_at=$2::timestamptz,end_at=$3::timestamptz,capacity=0,reason=$4,updated_by=$5::uuid,updated_at=now() WHERE id=$1::uuid",[override,a,b,"Private event: "+titleEn,staff.id]);
      else{
        const created=await tx.unsafe("INSERT INTO booking.capacity_overrides(start_at,end_at,capacity,reason,created_by,updated_by) VALUES($1::timestamptz,$2::timestamptz,0,$3,$4::uuid,$4::uuid) RETURNING id",[a,b,"Private event: "+titleEn,staff.id]);
        override=created[0].id;
      }
    }else if(override){
      await tx.unsafe("DELETE FROM booking.capacity_overrides WHERE id=$1::uuid",[override]);
      override=null;
    }
    if(needsBuffer){
      if(cleanupOverride)await tx.unsafe("UPDATE booking.capacity_overrides SET start_at=$2::timestamptz,end_at=$3::timestamptz,capacity=0,reason=$4,updated_by=$5::uuid,updated_at=now() WHERE id=$1::uuid",[cleanupOverride,b,cleanEnd,"Post-event cleaning 30m: "+titleEn,staff.id]);
      else{
        const created=await tx.unsafe("INSERT INTO booking.capacity_overrides(start_at,end_at,capacity,reason,created_by,updated_by) VALUES($1::timestamptz,$2::timestamptz,0,$3,$4::uuid,$4::uuid) RETURNING id",[b,cleanEnd,"Post-event cleaning 30m: "+titleEn,staff.id]);
        cleanupOverride=created[0].id;
      }
    } else if(cleanupOverride){
      await tx.unsafe("DELETE FROM booking.capacity_overrides WHERE id=$1::uuid",[cleanupOverride]);
      cleanupOverride=null;
    }
    const fields=[date,start,end,kind,status,titleEn,titleAr,msgEn,msgAr,ctaEn,ctaAr,url,block,override,staff.id];
    let saved:any;
    if(old){
      const changed=await tx.unsafe(
       "UPDATE booking.special_events SET event_date=$2::date,starts_at=$3::time,ends_at=$4::time,kind=$5,status=$6,title_en=$7,title_ar=$8,message_en=$9,message_ar=$10,cta_en=$11,cta_ar=$12,booking_url=$13,block_regular_booking=$14,capacity_override_id=$15::uuid,modified_by=$16::uuid,updated_at=now() WHERE id=$1::uuid RETURNING id::text AS id",
       [id,...fields]);
      saved=changed[0];
    }else{
      const created=await tx.unsafe(
       "INSERT INTO booking.special_events(event_date,starts_at,ends_at,kind,status,title_en,title_ar,message_en,message_ar,cta_en,cta_ar,booking_url,block_regular_booking,capacity_override_id,created_by,modified_by) VALUES($1::date,$2::time,$3::time,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid,$15::uuid,$15::uuid) RETURNING id::text AS id",
       fields);
      saved=created[0];
    }
    await tx.unsafe("UPDATE booking.special_events SET guest_count=$2::int,order_details=$3,setup_notes=$4,post_event_buffer_override_id=$5::uuid WHERE id=$1::uuid",
      [saved.id,guests,orders,setup,cleanupOverride]);
    await audit(tx,staff,old?"UPDATE_EVENT":"CREATE_EVENT","event",saved.id,old?{status:old.status,date:old.event_date,title_en:old.title_en}:null,
     {date,start,end,kind,status,titleEn,block,conflicts,guests,has_orders:orders.length>0,has_setup:setup.length>0});
    return {saved:true,id:saved.id,blocked_regular:needsBlock,confirmed_bookings_kept:conflicts};
   });
   return json({ok:true,...result},200,origin);
  }
  if(action==="cancel_event"){
   requireEdit(staff);
   const id=clean(body.id,60);
   if(!uuidRE.test(id))throw Error("INVALID_EVENT_ID");
   const result=await sql.begin(async tx=>{
    const rows=await tx.unsafe("SELECT * FROM booking.special_events WHERE id=$1::uuid FOR UPDATE",[id]);
    if(!rows.length)throw Error("EVENT_NOT_FOUND");
    const old=rows[0];
    if(old.capacity_override_id)await tx.unsafe("DELETE FROM booking.capacity_overrides WHERE id=$1::uuid",[old.capacity_override_id]);
    if(old.post_event_buffer_override_id)await tx.unsafe("DELETE FROM booking.capacity_overrides WHERE id=$1::uuid",[old.post_event_buffer_override_id]);
    await tx.unsafe("UPDATE booking.special_events SET status='CANCELLED',capacity_override_id=null,post_event_buffer_override_id=null,modified_by=$2::uuid,updated_at=now() WHERE id=$1::uuid",[id,staff.id]);
    await audit(tx,staff,"CANCEL_EVENT","event",id,{date:old.event_date,title:old.title_en,status:old.status},{status:"CANCELLED"});
    return {cancelled:true};
   });
   return json({ok:true,...result},200,origin);
  }

  if(action==="ack_day_note"){
   const id=Number(body.note_id);
   if(!Number.isSafeInteger(id)||id<1)throw Error("INVALID_NOTE_ID");
   const rows=await sql.unsafe("SELECT id FROM booking.staff_day_notes WHERE id=$1::bigint AND created_at>now()-interval '90 days'",[id]);
   if(!rows.length)throw Error("NOTE_NOT_FOUND");
   await sql.unsafe("INSERT INTO booking.staff_note_acknowledgements(note_id,user_id) VALUES($1::bigint,$2::uuid) ON CONFLICT(note_id,user_id) DO NOTHING",[id,staff.id]);
   return json({ok:true,acknowledged:true,note_id:id},200,origin);
  }
  if(action==="day_notes"){
   const date=clean(body.date,10);
   if(!dateRE.test(date))throw Error("INVALID_DATE");
   const rows=await sql.unsafe(
    "SELECT n.id::text AS id,n.note_day::text AS day,n.author_role,n.author_name,n.message,n.priority,n.created_at,EXISTS (SELECT 1 FROM booking.staff_note_acknowledgements ack WHERE ack.note_id=n.id AND ack.user_id=$2::uuid) AS acknowledged FROM booking.staff_day_notes n WHERE n.note_day=$1::date ORDER BY n.created_at ASC,n.id ASC LIMIT 200",[date,staff.id]);
   return json({ok:true,day:date,notes:rows},200,origin);
  }
  if(action==="add_day_note"){
   const date=clean(body.date,10),message=clean(body.message,600);
   if(!dateRE.test(date)||!message||message.length>600)throw Error("INVALID_NOTE");
   const result=await sql.begin(async tx=>{
    const rows=await tx.unsafe(
     "INSERT INTO booking.staff_day_notes(note_day,author_id,author_role,author_name,message) VALUES($1::date,$2::uuid,$3,$4,$5) RETURNING id::text AS id,note_day::text AS day,author_role,author_name,message,created_at",
     [date,staff.id,staff.role,clean(staff.name,160)||staff.email,message]);
    await audit(tx,staff,"DAY_NOTE","booking_day",date,null,{note_id:rows[0].id,message_length:message.length});
    return rows[0];
   });
   return json({ok:true,note:result},200,origin);
  }
  if(action==="dashboard"){
   const date=clean(body.date,10),party=Number(body.party_size??1);if(!dateRE.test(date)||!Number.isInteger(party)||party<1||party>40)throw Error("INVALID_DATE_OR_PARTY");
   const [bookings,overrides,holds,config,slots]=await Promise.all([
    sql.unsafe("SELECT b.id,b.reference,b.source,b.status,b.start_at,b.end_at,b.guests,b.customer_name,b.phone,b.email,b.experience,b.special_requests,b.notes,b.payment_status,b.payment_mode,b.amount_paid,b.menu_total,b.remaining_amount,b.prepayment_credit,b.estimated_preorder_balance,b.menu_order,coalesce(a.event,'PENDING') AS attendance FROM booking.bookings b LEFT JOIN LATERAL(SELECT event FROM booking.attendance_events WHERE booking_id=b.id ORDER BY occurred_at DESC,id DESC LIMIT 1) a ON true WHERE (b.start_at AT TIME ZONE 'Europe/London')::date=$1::date ORDER BY b.start_at ASC LIMIT 300",[date]),
    sql.unsafe("SELECT id,start_at,end_at,capacity,reason,created_at FROM booking.capacity_overrides WHERE start_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London') AND end_at > ($1::date::timestamp AT TIME ZONE 'Europe/London') ORDER BY start_at",[date]),
    sql.unsafe("SELECT count(*)::int as count,coalesce(sum(guests),0)::int AS covers FROM booking.booking_holds WHERE expires_at>now() AND released_at IS NULL AND converted_booking_id IS NULL AND (start_at AT TIME ZONE 'Europe/London')::date=$1::date",[date]),
    sql.unsafe("SELECT capacity,default_duration_minutes,cleaning_buffer_minutes,hold_minutes,timezone FROM booking.settings WHERE id=true"),
    sql.unsafe("SELECT to_char(s.local_time,'HH24:MI') AS time,s.remaining_covers,(s.available AND r.allowed) AS available,(s.available AND r.allowed AND $1::date>(now() AT TIME ZONE 'Europe/London')::date) AS online_available,r.reason AS rule_reason,a.capacity,a.booked_covers,a.held_covers,a.committed_covers FROM booking.available_slots($1::date,$2::integer,30,NULL) AS s CROSS JOIN LATERAL booking.availability(s.start_at,s.end_at) AS a CROSS JOIN LATERAL booking.visit_rules($1::date,s.local_time,$2::integer,NULL) AS r ORDER BY s.local_time",[date,party])
   ]);
   return json({ok:true,staff,date,bookings,overrides,holds:holds[0],settings:config[0],slots},200,origin);
  }
  if(action==="attendance"){
   const booking=clean(body.booking_id,40),event=clean(body.event,15);
   if(!uuidRE.test(booking)||!["ARRIVED","DEPARTED"].includes(event))throw Error("INVALID_ATTENDANCE");
   const result=await sql.begin(async tx=>{
    const rows=await tx.unsafe("SELECT id,status,start_at FROM booking.bookings WHERE id=$1::uuid FOR UPDATE",[booking]);
    if(rows[0]?.status!=="CONFIRMED")throw Error("BOOKING_NOT_CONFIRMED");
    const state=await tx.unsafe("SELECT event FROM booking.attendance_events WHERE booking_id=$1::uuid ORDER BY occurred_at DESC,id DESC LIMIT 1",[booking]);
    const previous=state[0]?.event||"PENDING";
    if((event==="ARRIVED"&&previous!=="PENDING")||(event==="DEPARTED"&&previous!=="ARRIVED"))throw Error("INVALID_ATTENDANCE_SEQUENCE");
    await tx.unsafe("INSERT INTO booking.attendance_events(booking_id,event,actor_id) VALUES($1::uuid,$2,$3::uuid)",[booking,event,staff.id]);
    await audit(tx,staff,event==="ARRIVED"?"CHECK_IN":"CHECK_OUT","booking",booking,{attendance:previous},{attendance:event});
    return {attendance:event};
   });
   return json({ok:true,...result},200,origin);
  }
  if(action==="create_phone"){
   requireEdit(staff);
   const date=clean(body.date,10),time=clean(body.time,5),guests=Number(body.guests),name=clean(body.customer_name,120);
   if(!dateRE.test(date)||!timeRE.test(time)||!Number.isInteger(guests)||guests<1||guests>40||!name)throw Error("INVALID_PHONE_BOOKING");
   const out=await sql.begin(async tx=>{
    const v=await tx.unsafe("SELECT * FROM booking.visit_rules($1::date,$2::time,$3::integer,NULL)",[date,time,guests]);
    if(!v[0]?.allowed)return {accepted:false,reason:v[0]?.reason||"NOT_AVAILABLE"};
    const rows=await tx.unsafe("SELECT * FROM booking.create_phone_booking($1::timestamptz,$2::timestamptz,$3::integer,$4,$5,$6,$7,$8)",
     [v[0].start_at,v[0].end_at,guests,name,clean(body.phone,80),clean(body.email,200),clean(body.experience,100),clean(body.notes,800)]);
    if(rows[0]?.accepted)await audit(tx,staff,"CREATE_PHONE","booking",String(rows[0].booking_id),null,{reference:rows[0].reference,date,time,guests});
    return rows[0]||{accepted:false,reason:"NOT_AVAILABLE"};
   });
   return json({ok:true,...out},200,origin);
  }
  if(action==="cancel"){
   requireEdit(staff);
   const id=clean(body.booking_id,40),reason=clean(body.reason,400);
   if(!uuidRE.test(id)||!reason)throw Error("CANCELLATION_REASON_REQUIRED");
   const result=await sql.begin(async tx=>{
    const rows=await tx.unsafe("SELECT id,reference,status,amount_paid FROM booking.bookings WHERE id=$1::uuid FOR UPDATE",[id]);
    const old=rows[0];if(old?.status!=="CONFIRMED")throw Error("BOOKING_NOT_CONFIRMED");
    const cancelled=await tx.unsafe("SELECT booking.cancel_booking($1::uuid) as cancelled",[id]);
    if(!cancelled[0]?.cancelled)throw Error("CANCEL_FAILED");
    await audit(tx,staff,"CANCEL","booking",id,{reference:old.reference,status:old.status,amount_paid:old.amount_paid},{status:"CANCELLED",reason});
    return {cancelled:true,financial_review_required:Number(old.amount_paid)>0};
   });
   return json({ok:true,...result},200,origin);
  }
  if(action==="edit"){
   requireEdit(staff);
   const id=clean(body.booking_id,40),date=clean(body.date,10),time=clean(body.time,5),guests=Number(body.guests);
   if(!uuidRE.test(id)||!dateRE.test(date)||!timeRE.test(time)||!Number.isInteger(guests)||guests<1||guests>40)throw Error("INVALID_EDIT");
   const out=await sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(2026110501)");
    const previous=await tx.unsafe("SELECT id,status,start_at,end_at,guests,reference,source,payment_status,amount_paid,shopify_order_id FROM booking.bookings WHERE id=$1::uuid FOR UPDATE",[id]);
    const old=previous[0];if(old?.status!=="CONFIRMED")throw Error("BOOKING_NOT_CONFIRMED");
    if(old.source==="WEB"||Number(old.amount_paid||0)>0||old.payment_status==="PAID"||old.shopify_order_id)throw Error("PAID_BOOKING_EDIT_REQUIRES_REVIEW");
    const newR=await tx.unsafe("SELECT * FROM booking.visit_rules($1::date,$2::time,$3::int,NULL)",[date,time,guests]);
    const rule=newR[0];if(!rule?.allowed)throw Error(rule?.reason||"BOOKING_NOT_ALLOWED");
    const capacity=await tx.unsafe("SELECT * FROM booking.availability($1::timestamptz,$2::timestamptz)",[rule.start_at,rule.end_at]);
    const a=capacity[0];const selfOverlaps=(new Date(old.start_at)<new Date(rule.end_at)&&new Date(rule.start_at)<new Date(old.end_at));
    const occupied=Number(a.committed_covers)-(selfOverlaps?Number(old.guests):0);
    if(occupied+guests>Number(a.capacity))throw Error("INSUFFICIENT_CAPACITY");
    await tx.unsafe("UPDATE booking.bookings SET start_at=$2::timestamptz,end_at=$3::timestamptz,guests=$4,updated_at=now() WHERE id=$1::uuid",
      [id,rule.start_at,rule.end_at,guests]);
    await audit(tx,staff,"EDIT","booking",id,{start_at:old.start_at,end_at:old.end_at,guests:old.guests},
     {start_at:rule.start_at,end_at:rule.end_at,guests});
    return {updated:true,reference:old.reference};
   });
   return json({ok:true,...out},200,origin);
  }
  if(action==="set_override"){
   requireEdit(staff);
   const date=clean(body.date,10),start=clean(body.start,5),end=clean(body.end,5),
    capacity=Number(body.capacity),reason=clean(body.reason,300);
   if(!dateRE.test(date)||!timeRE.test(start)||!(timeRE.test(end)||end==="24:00")||
      !Number.isInteger(capacity)||capacity<0||capacity>40||!reason)throw Error("INVALID_OVERRIDE");
   const bounds=await sql.unsafe("SELECT (($1::date+$2::time) AT TIME ZONE 'Europe/London') AS start_at,((($1::date+CASE WHEN $3='24:00' THEN 1 ELSE 0 END)+(CASE WHEN $3='24:00' THEN '00:00'::time ELSE $3::time END)) AT TIME ZONE 'Europe/London') AS end_at",[date,start,end]);
   const v=bounds[0];if(new Date(v.end_at)<=new Date(v.start_at))throw Error("INVALID_OVERRIDE_WINDOW");
   const result=await sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(2026110501)");
    const existing=await tx.unsafe("SELECT count(*)::int AS n,coalesce(sum(guests),0)::int AS covers FROM booking.bookings WHERE status='CONFIRMED' AND start_at<$2::timestamptz AND end_at>$1::timestamptz",[v.start_at,v.end_at]);
    const overlapping=Number(existing[0]?.n||0);
    if(overlapping>0&&!body.ack_existing)return {requires_ack:true,existing_bookings:overlapping,existing_covers:Number(existing[0].covers)};
    const saved=await tx.unsafe("INSERT INTO booking.capacity_overrides(start_at,end_at,capacity,reason,created_by,updated_by) VALUES($1::timestamptz,$2::timestamptz,$3,$4,$5::uuid,$5::uuid) RETURNING id",[v.start_at,v.end_at,capacity,reason,staff.id]);
    await audit(tx,staff,"SET_OVERRIDE","override",String(saved[0].id),null,{date,start,end,capacity,reason,overlapping});
    return {saved:true,id:saved[0].id,existing_bookings:overlapping};
   });
   return json({ok:true,...result},200,origin);
  }
  if(action==="delete_override"){
   requireEdit(staff);
   const id=clean(body.id,40);if(!uuidRE.test(id))throw Error("INVALID_OVERRIDE_ID");
   const result=await sql.begin(async tx=>{
    await tx.unsafe("SELECT pg_advisory_xact_lock(2026110501)");
    const linked=await tx.unsafe("SELECT 1 FROM booking.special_events WHERE capacity_override_id=$1::uuid OR post_event_buffer_override_id=$1::uuid LIMIT 1",[id]);
    if(linked.length)throw Error("EVENT_OVERRIDE_MANAGED");
    const gone=await tx.unsafe("DELETE FROM booking.capacity_overrides o WHERE o.id=$1::uuid AND NOT EXISTS(SELECT 1 FROM booking.special_events e WHERE e.capacity_override_id=o.id OR e.post_event_buffer_override_id=o.id) RETURNING o.id,o.start_at,o.end_at,o.capacity,o.reason",[id]);
    if(!gone.length)throw Error("OVERRIDE_NOT_FOUND_OR_MANAGED");
    await audit(tx,staff,"DELETE_OVERRIDE","override",id,gone[0],null);
    return {deleted:true};
   });return json({ok:true,...result},200,origin);
  }
  if(action==="audit"){
   if(staff.role==="employee")throw Error("PERMISSION_DENIED");
   const rows=await sql.unsafe("SELECT a.created_at,a.action,a.target_type,a.target_id,p.display_name AS actor,a.old_value,a.new_value FROM booking.staff_audit a JOIN booking.staff_profiles p ON p.user_id=a.actor_id ORDER BY a.created_at DESC LIMIT 75");
   return json({ok:true,rows},200,origin);
  }
  return json({ok:false,error:"UNKNOWN_ACTION"},404,origin);
 }catch(e){
  const msg=String(e instanceof Error?e.message:e).slice(0,100);
  const status=/AUTH_REQUIRED/.test(msg)?401:/ACCESS_DENIED|PERMISSION_DENIED|MFA_REQUIRED/.test(msg)?403:/INVALID|NOT_FOUND|CANCEL|INSUFFICIENT|ADMIN_|PARTY_|AFTER_|BEFORE_|SAME_|EVENT_OVERRIDE_MANAGED|PAID_BOOKING_EDIT/.test(msg)?409:500;
  if(status===500)console.error("staff api:",msg);
  return json({ok:false,error:status===500?"OPERATION_FAILED":msg},status,origin);
 }
});