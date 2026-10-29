import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MANAGER_IDS = new Set((Deno.env.get('TELEGRAM_MANAGER_IDS') ?? '').split(',').map(x => x.trim()).filter(Boolean));
const TIME_ZONE = Deno.env.get('APP_TIME_ZONE') ?? 'Europe/Moscow';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DAYS = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
const DAY_NAMES = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
type TgMessage = { message_id: number; chat: { id: number; type?: string }; from?: TgUser; text?: string };
type Update = { message?: TgMessage; callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string } };
type Session = { mode?: string; weekStart?: string; selectedDays?: number[]; dayIndex?: number; intervals?: Record<string,string[]>; comment?: string };

async function telegram(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok || !body.ok) console.error('Telegram API error', method, body);
  return body;
}
async function send(chatId: number, text: string, reply_markup?: unknown) {
  return telegram('sendMessage', { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}), disable_web_page_preview: true });
}
async function edit(chatId: number, messageId: number, text: string, reply_markup?: unknown) {
  return telegram('editMessageText', { chat_id: chatId, message_id: messageId, text, ...(reply_markup ? { reply_markup } : {}) });
}
async function saveSession(userId: number, chatId: number, state: Session) {
  await db.from('shift_bot_sessions').upsert({ telegram_user_id: userId, chat_id: chatId, state, updated_at: new Date().toISOString() });
}
async function getSession(userId: number): Promise<Session> {
  const { data } = await db.from('shift_bot_sessions').select('state').eq('telegram_user_id', userId).maybeSingle();
  return (data?.state ?? {}) as Session;
}
function dateAtZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function addDays(iso: string, count: number) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0,10); }
function mondayOf(iso: string) { const d = new Date(`${iso}T12:00:00Z`); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return d.toISOString().slice(0,10); }
function nextWeekStart() { const today = dateAtZone(new Date(), TIME_ZONE); const thisMonday = mondayOf(today); return today === thisMonday ? addDays(thisMonday, 7) : addDays(thisMonday, 7); }
function zonedWallTimeToUtc(date: string, time: string, timeZone: string) {
  const target = new Date(`${date}T${time}:00Z`);
  let guess = target.getTime();
  for (let i = 0; i < 3; i++) {
    const shown = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(guess));
    const part = (type: string) => shown.find(p => p.type === type)?.value ?? '00';
    const asUtc = Date.UTC(Number(part('year')), Number(part('month'))-1, Number(part('day')), Number(part('hour')), Number(part('minute')));
    guess += target.getTime() - asUtc;
  }
  return new Date(guess);
}
function deadlineOpen(weekStart: string) { return new Date() < zonedWallTimeToUtc(addDays(weekStart, -2), '00:00', TIME_ZONE); }
function dayDate(weekStart: string, dayIndex: number) { return addDays(weekStart, dayIndex); }
function dayKeyboard(selected: number[]) {
  const rows = [];
  for (let i=0;i<7;i+=2) rows.push([i, ...(i+1<7?[i+1]:[])].map(day => ({ text: `${selected.includes(day)?'☑':'◻'} ${DAYS[day]}`, callback_data: `day:${day}` })));
  rows.push([{ text: 'Продолжить →', callback_data: 'days:done' }]);
  return { inline_keyboard: rows };
}
function mainKeyboard() { return { inline_keyboard: [[{ text: '🗓 Подать пожелания по сменам', callback_data: 'request:start' }],[{ text: '🔔 Я менеджер', callback_data: 'manager:start' }]] }; }
function validIntervals(text: string): string[] | null {
  const parts = text.split(/[;,\n]+/).map(x => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const parsed: { start: string; end: string; raw: string }[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const sh=Number(m[1]), sm=Number(m[2]), eh=Number(m[3]), em=Number(m[4]);
    if (sh>23 || eh>23 || sm>59 || em>59 || sh*60+sm>=eh*60+em) return null;
    const start=`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
    const end=`${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
    if (parsed.some(p => start < p.end && end > p.start)) return null;
    parsed.push({start,end,raw:`${start}–${end}`});
  }
  return parsed.map(p=>p.raw);
}
function splitInterval(raw: string) { const [start,end]=raw.split(/[–-]/); return { starts_at: start, ends_at: end }; }
async function employeeFor(userId: number) {
  return db.from('employees').select('id,full_name,role,is_active').eq('telegram_user_id', userId).eq('is_active', true).maybeSingle();
}
async function notifyManagers(text: string) {
  const { data } = await db.from('shift_bot_managers').select('chat_id').eq('enabled', true);
  const chats = new Set<number>((data ?? []).map((x: {chat_id:number}) => Number(x.chat_id)));
  for (const id of MANAGER_IDS) chats.add(Number(id));
  let ok=0, failed=0;
  for (const chatId of chats) { const r=await telegram('sendMessage',{chat_id:chatId,text}); if(r?.ok) ok++; else failed++; }
  return {ok,failed};
}
async function startRequest(user: TgUser, chatId: number) {
  const { data: employee } = await employeeFor(user.id);
  if (!employee) { await send(chatId, 'Сначала менеджер должен привязать ваш Telegram-аккаунт к записи сотрудника. Напишите менеджеру, чтобы завершить привязку.'); return; }
  const weekStart = nextWeekStart();
  if (!deadlineOpen(weekStart)) { await send(chatId, 'Свяжитесь с менеджером для составления графика'); return; }
  const state: Session = { mode:'select_days', weekStart, selectedDays:[], dayIndex:0, intervals:{}, comment:'' };
  await saveSession(user.id, chatId, state);
  await send(chatId, `Привет, ${employee.full_name}!\n\nВыберите дни следующей недели (${weekStart} — ${addDays(weekStart,6)}), когда вы можете работать. Нажмите на день, чтобы выбрать или убрать его.`, dayKeyboard([]));
}
async function submitRequest(userId: number, chatId: number, state: Session) {
  const { data: employee } = await employeeFor(userId);
  if (!employee || !state.weekStart) { await send(chatId, 'Не удалось подтвердить ваш профиль. Обратитесь к менеджеру.'); return; }
  if (!deadlineOpen(state.weekStart)) { await send(chatId, 'Свяжитесь с менеджером для составления графика'); return; }
  const { data: request, error } = await db.from('availability_requests').upsert({ employee_id:employee.id, week_start:state.weekStart, status:'new', comment:state.comment ?? '', updated_at:new Date().toISOString() }, { onConflict:'employee_id,week_start' }).select('id').single();
  if (error || !request) { console.error(error); await send(chatId, 'Не удалось сохранить пожелания. Попробуйте позже или сообщите менеджеру.'); return; }
  await db.from('availability_intervals').delete().eq('request_id', request.id);
  const rows = (state.selectedDays ?? []).flatMap(day => (state.intervals?.[String(day)] ?? []).map(raw => ({ request_id:request.id, work_date:dayDate(state.weekStart!,day), ...splitInterval(raw) })));
  if (rows.length) { const { error: intervalError } = await db.from('availability_intervals').insert(rows); if (intervalError) { console.error(intervalError); await send(chatId,'Заявка создана, но интервалы не сохранились. Сообщите менеджеру.'); return; } }
  const daysText = (state.selectedDays ?? []).sort((a,b)=>a-b).map(day => `${DAY_NAMES[day]} (${dayDate(state.weekStart!,day)}): ${(state.intervals?.[String(day)] ?? []).join(', ')}`).join('\n') || 'Дни и интервалы не указаны';
  const notification = `📩 Новые пожелания по сменам\n\nСотрудник: ${employee.full_name}\nНеделя с ${state.weekStart}\n\n${daysText}\n\nКомментарий: ${state.comment?.trim() || 'нет'}\nЗаявка: ${request.id}`;
  const delivery = await notifyManagers(notification);
  await db.from('shift_bot_sessions').delete().eq('telegram_user_id', userId);
  await send(chatId, `Готово! Ваши пожелания сохранены и отправлены менеджерам.\n\n${delivery.failed ? `Уведомления доставлены: ${delivery.ok}; не доставлены: ${delivery.failed}.` : `Уведомления отправлены ${delivery.ok} менеджерам.`}`, mainKeyboard());
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('shift-bot webhook is running', { status: 200 });
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response('Missing required secrets', { status: 500 });
  let update: Update;
  try { update = await req.json(); } catch { return new Response('Bad JSON', { status:400 }); }
  const message = update.message;
  const callback = update.callback_query;
  const user = message?.from ?? callback?.from;
  const chatId = message?.chat.id ?? callback?.message?.chat.id;
  if (!user || !chatId) return new Response('ok');
  if (callback) await telegram('answerCallbackQuery', { callback_query_id: callback.id });
  const text = message?.text?.trim() ?? '';
  const data = callback?.data ?? '';

  if (text === '/start' || text === '/menu') { await send(chatId, 'Добро пожаловать! Здесь можно отправить пожелания по сменам или подключить уведомления для менеджера.', mainKeyboard()); return new Response('ok'); }
  if (data === 'manager:start' || text === '/manager') {
    const isAllowed = MANAGER_IDS.has(String(user.id));
    const { data: employee } = await employeeFor(user.id);
    if (!isAllowed && employee?.role !== 'manager') { await send(chatId, 'Доступ к уведомлениям менеджера не разрешён. Попросите администратора добавить ваш Telegram ID в список менеджеров.'); return new Response('ok'); }
    const { error } = await db.from('shift_bot_managers').upsert({ telegram_user_id:user.id, chat_id:chatId, enabled:true });
    if (error) { console.error(error); await send(chatId, 'Не удалось включить уведомления. Попробуйте позже.'); }
    else await send(chatId, '✅ Вы подключены как менеджер. Новые пожелания по сменам будут приходить сюда в личные сообщения.', mainKeyboard());
    return new Response('ok');
  }
  if (data === 'request:start' || text === '/request') { await startRequest(user, chatId); return new Response('ok'); }

  const state = await getSession(user.id);
  if (data.startsWith('day:') && state.mode === 'select_days') {
    const day = Number(data.split(':')[1]);
    if (day>=0 && day<7) state.selectedDays = (state.selectedDays ?? []).includes(day) ? (state.selectedDays ?? []).filter(x=>x!==day) : [...(state.selectedDays ?? []),day];
    await saveSession(user.id,chatId,state);
    if (callback?.message) await edit(chatId,callback.message.message_id,`Выберите дни следующей недели.\n\nВыбрано: ${(state.selectedDays??[]).sort((a,b)=>a-b).map(x=>DAYS[x]).join(', ') || 'пока ничего'}`,dayKeyboard(state.selectedDays??[]));
    return new Response('ok');
  }
  if (data === 'days:done' && state.mode === 'select_days') {
    state.selectedDays = (state.selectedDays ?? []).sort((a,b)=>a-b);
    if (!state.selectedDays.length) { await send(chatId,'Выберите хотя бы один день.',dayKeyboard([])); return new Response('ok'); }
    state.mode='enter_intervals'; state.dayIndex=0; await saveSession(user.id,chatId,state);
    const day=state.selectedDays[0]; await send(chatId,`${DAY_NAMES[day]} (${dayDate(state.weekStart!,day)}): отправьте время в формате 07:00-15:00.\nМожно несколько интервалов через запятую: 07:00-12:00, 14:00-18:00.\nЕсли в этот день работать не можете, нажмите «Пропустить».`,{inline_keyboard:[[{text:'Пропустить день',callback_data:'day:skip'}],[{text:'Отменить',callback_data:'request:cancel'}]]}); return new Response('ok');
  }
  if (data === 'request:cancel') { await db.from('shift_bot_sessions').delete().eq('telegram_user_id',user.id); await send(chatId,'Подача пожеланий отменена.',mainKeyboard()); return new Response('ok'); }
  if (data === 'day:skip' && state.mode === 'enter_intervals') {
    const selected=state.selectedDays ?? []; const idx=state.dayIndex ?? 0; state.intervals ??= {}; state.intervals[String(selected[idx])] = [];
    state.dayIndex=idx+1;
    if (state.dayIndex < selected.length) { const next=selected[state.dayIndex]; await saveSession(user.id,chatId,state); await send(chatId,`${DAY_NAMES[next]} (${dayDate(state.weekStart!,next)}): отправьте интервалы, например 07:00-15:00.`,{inline_keyboard:[[{text:'Пропустить день',callback_data:'day:skip'}],[{text:'Отменить',callback_data:'request:cancel'}]]}); }
    else { state.mode='comment'; await saveSession(user.id,chatId,state); await send(chatId,'Добавьте комментарий менеджеру или отправьте «-», если комментария нет.'); }
    return new Response('ok');
  }
  if (state.mode === 'enter_intervals' && message?.text) {
    const selected=state.selectedDays ?? []; const idx=state.dayIndex ?? 0; const intervals=validIntervals(text);
    if (!intervals) { await send(chatId,'Не распознал время. Используйте формат 07:00-15:00. Несколько интервалов можно указать через запятую. Начало должно быть раньше окончания, интервалы не должны пересекаться.'); return new Response('ok'); }
    state.intervals ??= {}; state.intervals[String(selected[idx])] = intervals; state.dayIndex=idx+1;
    if (state.dayIndex < selected.length) { const next=selected[state.dayIndex]; await saveSession(user.id,chatId,state); await send(chatId,`${DAY_NAMES[next]} (${dayDate(state.weekStart!,next)}): отправьте интервалы, например 07:00-15:00.`,{inline_keyboard:[[{text:'Пропустить день',callback_data:'day:skip'}],[{text:'Отменить',callback_data:'request:cancel'}]]}); }
    else { state.mode='comment'; await saveSession(user.id,chatId,state); await send(chatId,'Добавьте комментарий менеджеру или отправьте «-», если комментария нет.'); }
    return new Response('ok');
  }
  if (state.mode === 'comment' && message?.text) {
    state.comment = text === '-' ? '' : text.slice(0,1000); state.mode='confirm'; await saveSession(user.id,chatId,state);
    const summary=(state.selectedDays??[]).sort((a,b)=>a-b).map(day=>`${DAY_NAMES[day]}: ${(state.intervals?.[String(day)]??[]).join(', ') || 'не указано'}`).join('\n');
    await send(chatId,`Проверьте пожелания:\n\n${summary}\n\nКомментарий: ${state.comment || 'нет'}\n\nОтправить менеджерам?`,{inline_keyboard:[[{text:'✅ Отправить',callback_data:'request:submit'}],[{text:'Отменить',callback_data:'request:cancel'}]]}); return new Response('ok');
  }
  if (data === 'request:submit' && state.mode === 'confirm') { await submitRequest(user.id,chatId,state); return new Response('ok'); }
  await send(chatId,'Выберите действие в меню ниже.',mainKeyboard());
  return new Response('ok');
});
