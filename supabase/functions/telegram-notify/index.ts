const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN');if(!token)return Response.json({ok:false,error:'TELEGRAM_BOT_TOKEN is not configured'},{status:503,headers:cors});
  const {chatId,text}=await req.json();if(!Number.isSafeInteger(chatId)||typeof text!=='string'||!text.trim())return Response.json({ok:false,error:'chatId and text are required'},{status:400,headers:cors});
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});const result=await r.json();
  if(!r.ok||!result.ok)return Response.json({ok:false,error:result.description||'Telegram send failed'},{status:502,headers:cors});
  return Response.json({ok:true,message_id:result.result?.message_id},{headers:{...cors,'Content-Type':'application/json'}});
 }catch(e){console.error(e);return Response.json({ok:false,error:'Notification service failed'},{status:500,headers:cors});}
});
