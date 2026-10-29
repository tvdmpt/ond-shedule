import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key: CryptoKey, value: string) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
async function verifyTelegramInitData(initData: string, token: string): Promise<{ id: number } | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await hmac(k1, token);
  const k2 = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  if (hex(await hmac(k2, dataCheckString)) !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400 || authDate > now + 60) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    return Number.isSafeInteger(user.id) ? { id: user.id } : null;
  } catch { return null; }
}
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: cors });
  try {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const managerIds = (Deno.env.get('TELEGRAM_MANAGER_CHAT_IDS') || '').split(',').map((x) => x.trim()).filter(Boolean);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!token || !managerIds.length || !supabaseUrl || !serviceKey) {
      return Response.json({ ok: false, error: 'Настройте TELEGRAM_BOT_TOKEN, TELEGRAM_MANAGER_CHAT_IDS и Supabase secrets' }, { status: 503, headers: cors });
    }
    const body = await req.json();
    if (typeof body.initData !== 'string' || typeof body.weekStart !== 'string' || !Array.isArray(body.intervals)) {
      return Response.json({ ok: false, error: 'Некорректные данные пожеланий' }, { status: 400, headers: cors });
    }
    const tgUser = await verifyTelegramInitData(body.initData, token);
    if (!tgUser) return Response.json({ ok: false, error: 'Telegram-сеанс не прошёл проверку. Откройте приложение из Telegram.' }, { status: 401, headers: cors });
    const db = createClient(supabaseUrl, serviceKey);
    const { data: employee, error } = await db.from('employees').select('id,full_name,is_active').eq('telegram_user_id', tgUser.id).maybeSingle();
    if (error) throw error;
    if (!employee?.is_active) return Response.json({ ok: false, error: 'Telegram-аккаунт не привязан к сотруднику' }, { status: 403, headers: cors });

    const dayNames = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
    const intervals = body.intervals as { date: string; start: string; end: string }[];
    const lines = intervals.map((item) => {
      const date = new Date(`${item.date}T12:00:00`);
      const day = dayNames[(date.getDay() + 6) % 7] || '';
      return `• ${day} ${item.date}: ${item.start}–${item.end}`;
    });
    const message = [
      '📋 <b>Новые пожелания по графику</b>',
      `<b>Сотрудник:</b> ${escapeHtml(employee.full_name)}`,
      `<b>Неделя с:</b> ${escapeHtml(body.weekStart)}`,
      '',
      '<b>Доступность:</b>',
      ...(lines.length ? lines.map(escapeHtml) : ['Интервалы не указаны']),
      body.comment ? `\n<b>Комментарий:</b> ${escapeHtml(String(body.comment).slice(0, 1000))}` : '',
    ].filter(Boolean).join('\n');

    const results = await Promise.all(managerIds.map(async (chat_id) => {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const result = await response.json();
      return { ok: response.ok && result.ok === true, error: result.description };
    }));
    const sent = results.filter((result) => result.ok).length;
    if (sent === 0) return Response.json({ ok: false, error: 'Telegram не доставил сообщение. Менеджеры должны сначала запустить бота.' }, { status: 502, headers: cors });
    return Response.json({ ok: true, sent, failed: results.length - sent }, { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: 'Не удалось отправить пожелания менеджерам' }, { status: 500, headers: cors });
  }
});
