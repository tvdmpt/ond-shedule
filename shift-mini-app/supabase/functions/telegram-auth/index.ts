import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
async function sign(key: CryptoKey, value: string) { return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(value))); }
async function verify(initData: string, token: string) {
 const p=new URLSearchParams(initData), hash=p.get('hash'); if(!hash)return null; p.delete('hash');
 const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const k1=await crypto.subtle.importKey('raw',enc.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const secret=await sign(k1,token); const k2=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=hex(await sign(k2,check)); if(expected!==hash)return null;
 const authDate=Number(p.get('auth_date')||0); if(!authDate||Date.now()/1000-authDate>86400||authDate>Date.now()/1000+60)return null;
 try{return JSON.parse(p.get('user')||'{}') as {id:number}}catch{return null;}
}
function b64(input: Uint8Array|string) { const b=typeof input==='string'?enc.encode(input):input; let s=''; b.forEach(x=>s+=String.fromCharCode(x)); return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
async function jwt(payload:Record<string,unknown>,secret:string){const data=`${b64(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${b64(JSON.stringify(payload))}`;const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return `${data}.${b64(await sign(k,data))}`;}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const {initData}=await req.json();const token=Deno.env.get('TELEGRAM_BOT_TOKEN'),secret=Deno.env.get('SUPABASE_JWT_SECRET');
  if(!token||!secret)return Response.json({error:'Server secrets are not configured'},{status:503,headers:cors});
  if(typeof initData!=='string'||!initData)return Response.json({error:'initData is required'},{status:400,headers:cors});
  const user=await verify(initData,token);if(!user?.id)return Response.json({error:'Invalid or expired Telegram initData'},{status:401,headers:cors});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:emp,error}=await db.from('employees').select('id,full_name,role,is_active').eq('telegram_user_id',user.id).maybeSingle();if(error)throw error;
  if(!emp||!emp.is_active)return Response.json({error:'Telegram account is not linked to an active employee record'},{status:403,headers:cors});
  const now=Math.floor(Date.now()/1000);const access_token=await jwt({iss:'supabase',aud:'authenticated',role:'authenticated',sub:emp.id,iat:now,exp:now+3600,app_metadata:{provider:'telegram',providers:['telegram']},user_metadata:{full_name:emp.full_name}},secret);
  return Response.json({employee:{id:emp.id,name:emp.full_name,role:emp.role},access_token,expires_in:3600},{headers:{...cors,'Content-Type':'application/json'}});
 }catch(e){console.error(e);return Response.json({error:'Authentication service failed'},{status:500,headers:cors});}
});
