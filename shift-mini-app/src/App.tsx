import { useEffect, useMemo, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LogOut, MapPin, Plus, Send, Settings2, ShieldCheck, Trash2, Users, X, MoreHorizontal } from 'lucide-react';

type Employee = { id: string; name: string; role: 'manager'|'employee'; telegram_user_id?: number|null };
type Interval = { id: string; start: string; end: string };
type RequestItem = { id: string; employee_id: string; week_start: string; status: 'new'|'accepted'|'rejected'; comment: string; intervals: { date: string; start: string; end: string }[] };
type Shift = { id: string; employee_id: string; date: string; location: string; start: string; end: string; is_substitute?: boolean; substitute_from?: string };
type Requirement = { id: string; location: string; date: string; start: string; end: string; needed: number; kind: 'required'|'preferred'; weekdaysOnly?: boolean; weekendOnly?: boolean };

const PEOPLE: Employee[] = [
 {id:'andrey',name:'Дикун Андрей',role:'manager'}, {id:'polina',name:'Гриценко Полина',role:'manager'}, {id:'alsu',name:'Байрамгулова Алсу',role:'employee'}, {id:'vlad',name:'Греков Владислав',role:'manager'}, {id:'diana',name:'Саганджиева Диана',role:'employee'}, {id:'ekaterina-b',name:'Буханцева Екатерина',role:'employee'}, {id:'sofia',name:'Моисеенко София',role:'employee'}, {id:'yaroslav',name:'Дуров Ярослав',role:'employee'}, {id:'ekaterina-k',name:'Карачевцева Екатерина',role:'employee'}, {id:'yulia',name:'Ким Юлия',role:'employee'}, {id:'roman',name:'Дикун Роман',role:'employee'}
];
const LOCATIONS = ['ВК01','ВК03','ЗИЛ'];
const uid = () => Math.random().toString(36).slice(2,10);
const dateOnly = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function mondayOf(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return x; }
function addDays(s: string, n: number) { const d=new Date(`${s}T12:00:00`); d.setDate(d.getDate()+n); return dateOnly(d); }
function fmtDate(s:string, options: Intl.DateTimeFormatOptions={day:'numeric',month:'short'}) { return new Intl.DateTimeFormat('ru-RU',options).format(new Date(`${s}T12:00:00`)); }
function weekLabel(start:string) { return `${fmtDate(start)} — ${fmtDate(addDays(start,6),{day:'numeric',month:'short',year:'numeric'})}`; }
function deadlineOpen(weekStart:string) { const d = new Date(`${weekStart}T00:00:00`); d.setDate(d.getDate()-2); return Date.now() < d.getTime(); }
function requirementApplies(r: Requirement, date: string) { const weekday=(new Date(`${date}T12:00:00`).getDay()+6)%7; return (!r.date||r.date===date)&&(!r.weekdaysOnly||weekday<5)&&(!r.weekendOnly||weekday>=5); }
const demoRequests: RequestItem[] = [];
const demoShifts: Shift[] = [];

export default function App() {
 const envUrl = import.meta.env.VITE_SUPABASE_URL as string|undefined;
 const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
 const demoMode = import.meta.env.VITE_DEMO_MODE !== 'false';
 const supabase: SupabaseClient|null = envUrl && envKey ? createClient(envUrl,envKey) : null;
 const [employee,setEmployee] = useState<Employee|null>(null);
 const [requests,setRequests] = useState<RequestItem[]>(demoRequests);
 const [shifts,setShifts] = useState<Shift[]>(demoShifts);
 const [requirements,setRequirements] = useState<Requirement[]>([
  {id:'r1',location:'ВК01',date:'',start:'07:00',end:'15:00',needed:2,kind:'required',weekdaysOnly:true},
  {id:'r2',location:'ВК01',date:'',start:'11:00',end:'15:00',needed:2,kind:'preferred',weekdaysOnly:true},
  {id:'r3',location:'ВК01',date:'',start:'15:00',end:'22:00',needed:1,kind:'required'},
  {id:'r4',location:'ВК01',date:'',start:'07:00',end:'15:00',needed:1,kind:'required',weekendOnly:true},
  {id:'r5',location:'ВК03',date:'',start:'07:00',end:'22:00',needed:1,kind:'required'},
  {id:'r6',location:'ЗИЛ',date:'',start:'07:00',end:'22:00',needed:1,kind:'required'}
 ]);
 const [week,setWeek] = useState(addDays(dateOnly(mondayOf(new Date())),7));
 const [tab,setTab] = useState<'requests'|'schedule'|'manager'>('requests');
 const [selectedDate,setSelectedDate] = useState('');
 const [intervals,setIntervals] = useState<Interval[]>([]);
 const [comment,setComment] = useState('');
 const [toast,setToast] = useState('');
 const [showAddShift,setShowAddShift] = useState(false);
 const [newShift,setNewShift] = useState({employee_id:'',date:'',location:'ВК01',start:'07:00',end:'15:00',is_substitute:false,substitute_from:''});
 const [showRequirement,setShowRequirement] = useState(false);
 const [newReq,setNewReq] = useState({location:'ЗИЛ',date:'',start:'07:00',end:'15:00',needed:1,kind:'required' as 'required'|'preferred'});
 const [dark,setDark] = useState(false);
 const [tableLocation,setTableLocation] = useState('ВК01');
 const [locationMenuOpen,setLocationMenuOpen] = useState(false);
 const manager = employee?.role === 'manager';
 const days = useMemo(()=>Array.from({length:7},(_,i)=>addDays(week,i)),[week]);
 const myRequest = requests.find(r=>r.employee_id===employee?.id && r.week_start===week);
 const weekShifts = shifts.filter(s=>days.includes(s.date));
 const open = deadlineOpen(week);

 useEffect(()=>{
  const tg=(window as any).Telegram?.WebApp;
  if(tg?.themeParams?.bg_color) document.documentElement.style.setProperty('--tg-bg',tg.themeParams.bg_color);
  if(tg?.colorScheme==='dark') setDark(true);
  if(tg?.initData && supabase) {
   // The production authentication exchange is intentionally server-side. Never trust initDataUnsafe for identity.
   fetch(`${envUrl}/functions/v1/telegram-auth`,{method:'POST',headers:{'Content-Type':'application/json','apikey':envKey!},body:JSON.stringify({initData:tg.initData})})
    .then(r=>r.ok?r.json():Promise.reject(new Error('Telegram auth failed'))).then(data=>{
      if(data.employee) setEmployee(data.employee);
      if(data.access_token) { /* Supabase requests can use the returned short-lived JWT in a production auth client. */ }
    }).catch(()=>setToast('Не удалось подтвердить Telegram. Проверьте привязку аккаунта.'));
  }
 },[]);
 useEffect(()=>{ if(!toast)return; const t=setTimeout(()=>setToast(''),3200); return ()=>clearTimeout(t); },[toast]);
 useEffect(()=>{ if(selectedDate) { const dayItems=(myRequest?.intervals||[]).filter(x=>x.date===selectedDate); setIntervals(dayItems.map(x=>({id:uid(),start:x.start,end:x.end}))); } },[selectedDate]);

 function saveRequest() {
  if(!employee) return;
  if(!open) { setToast('Свяжитесь с менеджером для составления графика'); return; }
  const flattened = [...(myRequest?.intervals||[]).filter(x=>x.date!==selectedDate),...intervals.map(i=>({date:selectedDate,start:i.start,end:i.end}))];
  for(const i of intervals) { if(i.start>=i.end) {setToast('Время окончания должно быть позже начала');return;} }
  const sorted=[...intervals].sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<sorted.length;i++) if(sorted[i].start<sorted[i-1].end) {setToast('Интервалы в один день пересекаются');return;}
  const item:RequestItem={id:myRequest?.id||uid(),employee_id:employee.id,week_start:week,status:myRequest?.status==='accepted'?'new':(myRequest?.status||'new'),comment,intervals:flattened};
  setRequests(old=>[...old.filter(r=>!(r.employee_id===employee.id&&r.week_start===week)),item]); setSelectedDate(''); setToast('Пожелания сохранены');
 }
 function decideRequest(id:string,status:'accepted'|'rejected') { setRequests(old=>old.map(r=>r.id===id?{...r,status}:r)); setToast(status==='accepted'?'Заявка принята':'Заявка отклонена'); }
 function addShift() {
  if(!newShift.employee_id||!newShift.date||newShift.start>=newShift.end){setToast('Проверьте сотрудника, дату и время');return;}
  // A person can only cover one territory at a time, including substitute assignments.
  const conflict=shifts.find(s=>s.employee_id===newShift.employee_id&&s.date===newShift.date&&newShift.start<s.end&&newShift.end>s.start);
  if(conflict){setToast(`Пересечение с ${conflict.location} (${conflict.start}–${conflict.end}). Один сотрудник не может закрывать две территории одновременно.`);return;}
  setShifts(old=>[...old,{...newShift,id:uid()}]); setShowAddShift(false); setToast(newShift.is_substitute?`Подмена назначена на ${newShift.location}; покрытие пересчитано`:'Смена добавлена');
 }
 function publish() {
  const missing=coverage.filter(c=>c.kind==='required'&&c.assigned<c.needed);
  const preferredMissing=coverage.filter(c=>c.kind==='preferred'&&c.assigned<c.needed);
  if(missing.length && !confirm(`Есть ${missing.length} незакрытых обязательных интервалов. Опубликовать с явным подтверждением исключения?`)) return;
  setToast(missing.length?`График опубликован с подтверждённым исключением. Дополнительных рекомендаций не закрыто: ${preferredMissing.length}.`:`График опубликован в демо-режиме${preferredMissing.length?`. Информация: не закрыто дополнительных потребностей — ${preferredMissing.length}.`:'.'}`);
 }
 const coverage = useMemo(()=>{
  const rows: (Requirement & {date:string;assigned:number})[]=[];
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
  for(const r of requirements){
   const dates=r.date?[r.date]:days.filter(d=>requirementApplies(r,d));
   for(const date of dates){
    if(!days.includes(date)) continue;
    const dayShifts=weekShifts.filter(s=>s.location===r.location&&s.date===date&&s.start<r.end&&s.end>r.start);
    const requiredRows=requirements.filter(other=>other.location===r.location&&other.kind==='required'&&requirementApplies(other,date)&&other.start<r.end&&other.end>r.start);
    const points=new Set<number>([minutes(r.start),minutes(r.end)]);
    for(const shift of dayShifts){points.add(Math.max(minutes(r.start),minutes(shift.start)));points.add(Math.min(minutes(r.end),minutes(shift.end)));}
    for(const req of requiredRows){points.add(Math.max(minutes(r.start),minutes(req.start)));points.add(Math.min(minutes(r.end),minutes(req.end)));}
    const sorted=[...points].filter(point=>point>=minutes(r.start)&&point<=minutes(r.end)).sort((a,b)=>a-b);
    const segmentCounts:number[]=[];
    for(let i=0;i<sorted.length-1;i++){
     const mid=(sorted[i]+sorted[i+1])/2;
     const active=dayShifts.filter(shift=>minutes(shift.start)<=mid&&minutes(shift.end)>mid).length;
     const mandatory=Math.max(0,...requiredRows.filter(req=>minutes(req.start)<=mid&&minutes(req.end)>mid).map(req=>req.needed));
     segmentCounts.push(r.kind==='preferred'?Math.max(0,active-mandatory):active);
    }
    const assigned=segmentCounts.length?Math.min(...segmentCounts):0;
    rows.push({...r,date,assigned});
   }
  }
  return rows;
 },[requirements,weekShifts,days]);
 const substituteStatus = useMemo(()=>{
  const result: Record<string,{covered:boolean;hasSubstitute:boolean;missing:number}> = {};
  const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
  for(const location of LOCATIONS) for(const date of days){
   const applicable=requirements.filter(r=>r.location===location&&r.kind==='required'&&requirementApplies(r,date)&&r.end>'07:00'&&r.start<'22:00');
   const dayShifts=weekShifts.filter(s=>s.location===location&&s.date===date&&s.end>'07:00'&&s.start<'22:00');
   const points=new Set<number>([420,1320]);
   applicable.forEach(r=>{points.add(Math.max(420,minutes(r.start)));points.add(Math.min(1320,minutes(r.end)));});
   dayShifts.forEach(s=>{points.add(Math.max(420,minutes(s.start)));points.add(Math.min(1320,minutes(s.end)));});
   const sorted=[...points].filter(x=>x>=420&&x<=1320).sort((a,b)=>a-b);
   let missing=0;
   for(let i=0;i<sorted.length-1;i++){
    const mid=(sorted[i]+sorted[i+1])/2;
    const needed=Math.max(0,...applicable.filter(r=>minutes(r.start)<=mid&&minutes(r.end)>mid).map(r=>r.needed));
    const assigned=dayShifts.filter(s=>minutes(s.start)<=mid&&minutes(s.end)>mid).length;
    if(assigned<needed) missing++;
   }
   result[`${location}:${date}`]={covered:missing===0,hasSubstitute:dayShifts.some(s=>s.is_substitute),missing};
  }
  return result;
 },[requirements,weekShifts,days]);
 function addInterval(){setIntervals(old=>[...old,{id:uid(),start:'09:00',end:'17:00'}]);}

 if(!employee) return <main className={dark?'app dark':'app'}><div className="brand"><div className="brand-mark"><CalendarDays size={22}/></div><div><h1>Смены</h1><p>График команды</p></div></div><section className="welcome card"><div className="eyebrow">КОМАНДА · 11 УЧАСТНИКОВ</div><h2>Добро пожаловать</h2><p className="muted">Выберите своё имя, чтобы открыть график и пожелания.</p><label className="field-label">Ваше имя</label><select className="input" defaultValue="" onChange={e=>{const p=PEOPLE.find(x=>x.id===e.target.value);if(p)setEmployee(p);}}><option value="" disabled>Выберите сотрудника</option>{PEOPLE.map(p=><option key={p.id} value={p.id}>{p.name}{p.role==='manager'?' · менеджер':''}</option>)}</select>{!demoMode&&<p className="small muted">В рабочей версии вход выполняется после проверки Telegram initData сервером.</p>}<p className="small muted">{demoMode?'Демо-вход для локального прототипа.':'Для продолжения требуется подтверждённый Telegram-сеанс.'}</p></section><p className="footer-note">Внутренний инструмент команды</p></main>;

 return <main className={dark?'app dark':'app'}>
  <header className="topbar"><div className="brand"><div className="brand-mark"><CalendarDays size={20}/></div><div><h1>Смены</h1><p>{employee.name}</p></div></div><button className="icon-btn" onClick={()=>setDark(!dark)} aria-label="Переключить тему"><Settings2 size={19}/></button></header>
  <section className="week-card"><div><div className="eyebrow">РАБОЧАЯ НЕДЕЛЯ</div><h2>{weekLabel(week)}</h2></div><div className="week-actions"><button className="icon-btn" onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft size={18}/></button><button className="icon-btn" onClick={()=>setWeek(dateOnly(mondayOf(new Date())))}>Сегодня</button><button className="icon-btn" onClick={()=>setWeek(addDays(week,7))}><ChevronRight size={18}/></button></div></section>
  <nav className="tabs"><button className={tab==='requests'?'active':''} onClick={()=>setTab('requests')}>Мои пожелания</button><button className={tab==='schedule'?'active':''} onClick={()=>setTab('schedule')}>График</button>{manager&&<button className={tab==='manager'?'active':''} onClick={()=>setTab('manager')}>Управление</button>}</nav>
  {tab==='requests'&&<>
   <section className="card"><div className="section-head"><div><h3>Когда вы можете работать?</h3><p className="muted">Выберите день и добавьте интервалы</p></div><span className={`status ${open?'status-open':'status-closed'}`}>{open?'Приём открыт':'Приём закрыт'}</span></div>
    {!open&&<div className="notice"><Clock3 size={18}/><span>Свяжитесь с менеджером для составления графика</span></div>}
    <div className="day-grid">{days.map((d,i)=>{const has=(myRequest?.intervals||[]).some(x=>x.date===d);return <button key={d} className={`day ${selectedDate===d?'chosen':''} ${has?'has-data':''}`} disabled={!open} onClick={()=>setSelectedDate(selectedDate===d?'':d)}><span>{['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'][i]}</span><b>{new Date(`${d}T12:00:00`).getDate()}</b>{has&&<i/>}</button>})}</div>
    {selectedDate&&<div className="interval-editor"><div className="section-head"><h4>{fmtDate(selectedDate,{weekday:'long',day:'numeric',month:'long'})}</h4><button className="text-btn" onClick={()=>setSelectedDate('')}><X size={16}/> Закрыть</button></div>{intervals.length===0&&<p className="muted small">Пока нет интервалов на этот день.</p>}{intervals.map((it,idx)=><div className="interval-row" key={it.id}><div className="time-field"><label>С</label><input type="time" value={it.start} onChange={e=>setIntervals(old=>old.map(x=>x.id===it.id?{...x,start:e.target.value}:x))}/></div><div className="time-field"><label>До</label><input type="time" value={it.end} onChange={e=>setIntervals(old=>old.map(x=>x.id===it.id?{...x,end:e.target.value}:x))}/></div><button className="icon-btn danger" onClick={()=>setIntervals(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>)}<button className="outline-btn full" onClick={addInterval}><Plus size={16}/> Добавить интервал</button><button className="primary-btn full" onClick={saveRequest}><Check size={17}/> Сохранить день</button></div>}
   </section>
   <section className="card"><div className="section-head"><h3>Мои пожелания</h3><span className="count">{myRequest?.intervals.length||0}</span></div><label className="field-label">Комментарий менеджеру <span className="muted">(необязательно)</span></label><textarea className="input textarea" value={comment||myRequest?.comment||''} onChange={e=>setComment(e.target.value)} placeholder="Например, могу выйти пораньше в пятницу…" disabled={!open}/><div className="request-list">{days.map(d=>{const items=(myRequest?.intervals||[]).filter(x=>x.date===d);if(!items.length)return null;return <div className="request-day" key={d}><div><b>{fmtDate(d,{weekday:'short',day:'numeric',month:'short'})}</b><div className="times">{items.map(x=><span key={x.start+x.end}>{x.start}–{x.end}</span>)}</div></div><button className="text-btn" onClick={()=>{setSelectedDate(d);setIntervals(items.map(x=>({...x,id:uid()})));}} disabled={!open}>Изменить</button></div>})}{!myRequest?.intervals.length&&<div className="empty"><CalendarDays size={24}/><p>Пока нет сохранённых пожеланий</p></div>}</div>{myRequest&&<div className="request-status"><span className={`dot ${myRequest.status}`}/><span>Статус заявки: <b>{myRequest.status==='new'?'Новая':myRequest.status==='accepted'?'Принята':'Отклонена'}</b></span></div>}</section>
  </>}
  {tab==='schedule'&&<section className="card"><div className="section-head"><div><h3>Опубликованный график</h3><p className="muted">Актуальные смены команды</p></div><span className="status status-open">Актуальный</span></div>{weekShifts.length===0?<div className="empty"><CalendarDays size={26}/><p>График на эту неделю ещё не опубликован</p></div>:days.map(d=>{const items=weekShifts.filter(s=>s.date===d).sort((a,b)=>a.start.localeCompare(b.start));if(!items.length)return null;return <div className="schedule-day" key={d}><h4>{fmtDate(d,{weekday:'long',day:'numeric',month:'long'})}</h4>{items.map(s=><div className="shift-row" key={s.id}><div className="shift-time">{s.start}<span>{s.end}</span></div><div className="shift-info"><b>{PEOPLE.find(p=>p.id===s.employee_id)?.name||'Сотрудник'}</b><span><MapPin size={13}/>{s.location}</span></div>{s.employee_id===employee.id&&<span className="mine-tag">Моя смена</span>}</div>)}</div>})}</section>}
  {tab==='manager'&&manager&&<>
   <section className="card"><div className="section-head"><div><h3>Заявки команды</h3><p className="muted">Пожелания на выбранную неделю</p></div><span className="count">{requests.filter(r=>r.week_start===week).length}</span></div>{requests.filter(r=>r.week_start===week).length===0?<div className="empty"><Users size={25}/><p>Пока заявок нет</p></div>:requests.filter(r=>r.week_start===week).map(r=><div className="manager-request" key={r.id}><div className="section-head"><div><b>{PEOPLE.find(p=>p.id===r.employee_id)?.name}</b><p className="muted small">{r.intervals.length} интервалов</p></div><span className={`status ${r.status==='accepted'?'status-open':r.status==='rejected'?'status-closed':'status-neutral'}`}>{r.status==='new'?'Новая':r.status==='accepted'?'Принята':'Отклонена'}</span></div><div className="times wrap">{r.intervals.map(x=><span key={x.date+x.start}>{fmtDate(x.date)} · {x.start}–{x.end}</span>)}</div>{r.comment&&<p className="comment">«{r.comment}»</p>}{r.status==='new'&&<div className="button-row"><button className="outline-btn" onClick={()=>decideRequest(r.id,'rejected')}><X size={15}/> Отклонить</button><button className="primary-btn" onClick={()=>decideRequest(r.id,'accepted')}><Check size={15}/> Принять</button></div>}</div>)}</section>
   <section className="card"><div className="section-head"><div><h3>Редактор графика</h3><p className="muted">Назначайте сотрудникам локации и смены</p></div><button className="primary-btn" onClick={()=>{setNewShift({employee_id:employee.id,date:days[0],location:'ВК01',start:'07:00',end:'15:00',is_substitute:false,substitute_from:''});setShowAddShift(true)}}><Plus size={16}/> Смена</button></div>{weekShifts.length===0?<p className="muted small">Добавьте первую смену для выбранной недели.</p>:weekShifts.map(s=><div className="admin-shift" key={s.id}><div><b>{PEOPLE.find(p=>p.id===s.employee_id)?.name}</b><p className="muted small">{fmtDate(s.date)} · {s.start}–{s.end} · {s.location}{s.is_substitute?` · Подмена с ${s.substitute_from}`:''}</p></div><button className="icon-btn danger" onClick={()=>setShifts(old=>old.filter(x=>x.id!==s.id))}><Trash2 size={16}/></button></div>)}<div className="table-location-toolbar"><div><span className="muted small">Локация графика</span><b className="table-location-name">{tableLocation}</b></div><div className="location-menu-wrap"><button className="icon-btn" aria-label="Выбрать локацию" onClick={()=>setLocationMenuOpen(v=>!v)}><MoreHorizontal size={19}/></button>{locationMenuOpen&&<div className="location-menu">{LOCATIONS.map(loc=><button key={loc} className={tableLocation===loc?'selected':''} onClick={()=>{setTableLocation(loc);setLocationMenuOpen(false)}}>{loc}{tableLocation===loc&&<Check size={15}/>}</button>)}</div>}</div></div><div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Сотрудник</th>{['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(day=><th key={day}>{day}</th>)}</tr></thead><tbody>{PEOPLE.map(person=><tr key={person.id}><th scope="row">{person.name}</th>{days.map(day=>{const assigned=weekShifts.filter(s=>s.employee_id===person.id&&s.date===day&&s.location===tableLocation).sort((a,b)=>a.start.localeCompare(b.start));return <td key={day}>{assigned.length?assigned.map(s=><div className="table-shift" key={s.id}><b>{s.start.slice(0,5)}–{s.end.slice(0,5)}</b>{s.is_substitute&&<span>Подмена</span>}</div>):<span className="table-empty">—</span>}</td>})}</tr>)}<tr className="substitute-status-row"><th scope="row">ПОДМЕНА</th>{days.map(day=>{const status=substituteStatus[`${tableLocation}:${day}`];const found=status?.covered&&status?.hasSubstitute;const covered=status?.covered;return <td key={day}><span className={`substitute-status ${covered?'found':'missing'}`} title={covered?(found?'Обязательное покрытие закрыто подменным сотрудником':'Обязательное покрытие 07:00–22:00 закрыто; подмена не требуется'):(status?.hasSubstitute?'Подмена назначена, но остались незакрытые обязательные интервалы':'Есть незакрытые обязательные интервалы 07:00–22:00')}>{covered?<><Check size={13}/> {found?'Найдена':'Не нужна'}</>:<><X size={13}/> {status?.hasSubstitute?'Не закрыто':'Нужна'}</>}</span></td>})}</tr></tbody></table></div><p className="small muted">В таблице показаны только смены выбранной локации. Статус «ПОДМЕНА» рассчитывается автоматически по обязательному покрытию с 07:00 до 22:00: учитываются реальные смены, включая назначенные подмены. Желательная потребность ВК01 не влияет на статус.</p></section>
   <section className="card"><div className="section-head"><div><h3>Покрытие смен</h3><p className="muted">Потребность и назначенные сотрудники</p></div><button className="icon-btn" onClick={()=>{setNewReq({...newReq,date:days[0]});setShowRequirement(true)}}><Plus size={17}/></button></div>{coverage.map((c,i)=><div className="coverage-row" key={c.id+i}><div className="coverage-title"><b>{c.location}</b><span>{fmtDate(c.date,{weekday:'short',day:'numeric',month:'short'})} · {c.start}–{c.end}</span><span className={`requirement-tag ${c.kind}`}>{c.kind==='required'?'Обязательная потребность':'Дополнительная · желательно'}</span></div><div className="coverage-number"><b className={c.assigned<c.needed&&c.kind==='required'?'bad':''}>{c.assigned} / {c.needed}</b><span>назначено / нужно</span>{c.assigned<c.needed&&c.kind==='preferred'&&<span className="coverage-info">Не блокирует публикацию</span>}{c.assigned<c.needed&&c.kind==='required'&&<span className="coverage-warning">Не хватает {c.needed-c.assigned}</span>}</div></div>)}<button className="primary-btn full publish-btn" onClick={publish}><Send size={16}/> Проверить и опубликовать</button><p className="small muted">В демо-режиме публикация не рассылает сообщения и не сохраняет серверную версию.</p></section>
  </>}
  {showAddShift&&<div className="modal-backdrop" onClick={()=>setShowAddShift(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="section-head"><h3>Новая смена</h3><button className="icon-btn" onClick={()=>setShowAddShift(false)}><X size={18}/></button></div><label className="field-label">Сотрудник</label><select className="input" value={newShift.employee_id} onChange={e=>setNewShift({...newShift,employee_id:e.target.value})}>{PEOPLE.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><label className="field-label">Дата</label><select className="input" value={newShift.date} onChange={e=>setNewShift({...newShift,date:e.target.value})}>{days.map(d=><option key={d} value={d}>{fmtDate(d,{weekday:'long',day:'numeric',month:'long'})}</option>)}</select><label className="field-label">Локация назначения (покрытие)</label><select className="input" value={newShift.location} onChange={e=>{const location=e.target.value;setNewShift({...newShift,location,substitute_from:newShift.is_substitute&&newShift.substitute_from===location?(LOCATIONS.find(l=>l!==location)||''):newShift.substitute_from});}}>{LOCATIONS.map(l=><option key={l}>{l}</option>)}</select><label className="substitute-toggle"><input type="checkbox" checked={newShift.is_substitute} onChange={e=>setNewShift({...newShift,is_substitute:e.target.checked,substitute_from:e.target.checked?(LOCATIONS.find(l=>l!==newShift.location)||'ВК03'):''})}/> Подменный сотрудник с другой территории</label>{newShift.is_substitute&&<><label className="field-label">Откуда приходит подмена</label><select className="input" value={newShift.substitute_from} onChange={e=>setNewShift({...newShift,substitute_from:e.target.value})}>{LOCATIONS.filter(l=>l!==newShift.location).map(l=><option key={l}>{l}</option>)}</select><p className="small muted">Смена учитывается в покрытии {newShift.location}; пересечение с другой сменой этого сотрудника запрещено.</p></>}<div className="interval-row"><div className="time-field"><label>Начало</label><input type="time" value={newShift.start} onChange={e=>setNewShift({...newShift,start:e.target.value})}/></div><div className="time-field"><label>Окончание</label><input type="time" value={newShift.end} onChange={e=>setNewShift({...newShift,end:e.target.value})}/></div></div><button className="primary-btn full" onClick={addShift}><Check size={16}/> Сохранить смену</button></div></div>}
  {showRequirement&&<div className="modal-backdrop" onClick={()=>setShowRequirement(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="section-head"><h3>Потребность в сотрудниках</h3><button className="icon-btn" onClick={()=>setShowRequirement(false)}><X size={18}/></button></div><label className="field-label">Локация</label><select className="input" value={newReq.location} onChange={e=>setNewReq({...newReq,location:e.target.value})}>{LOCATIONS.map(l=><option key={l}>{l}</option>)}</select><label className="field-label">Дата</label><select className="input" value={newReq.date} onChange={e=>setNewReq({...newReq,date:e.target.value})}>{days.map(d=><option key={d} value={d}>{fmtDate(d,{weekday:'long',day:'numeric',month:'long'})}</option>)}</select><div className="interval-row"><div className="time-field"><label>Начало</label><input type="time" value={newReq.start} onChange={e=>setNewReq({...newReq,start:e.target.value})}/></div><div className="time-field"><label>Окончание</label><input type="time" value={newReq.end} onChange={e=>setNewReq({...newReq,end:e.target.value})}/></div></div><label className="field-label">Количество сотрудников</label><input className="input" type="number" min="1" max="30" value={newReq.needed} onChange={e=>setNewReq({...newReq,needed:Number(e.target.value)})}/><label className="field-label">Тип потребности</label><select className="input" value={newReq.kind} onChange={e=>setNewReq({...newReq,kind:e.target.value as any})}><option value="required">Обязательно</option><option value="preferred">Желательно</option></select><button className="primary-btn full" onClick={()=>{if(newReq.start>=newReq.end||newReq.needed<1){setToast('Проверьте интервал и количество');return;}setRequirements(old=>[...old,{...newReq,id:uid()}]);setShowRequirement(false);setToast('Потребность добавлена');}}><Check size={16}/> Сохранить потребность</button></div></div>}
  <footer className="app-footer"><ShieldCheck size={14}/><span>{manager?'Панель менеджера':'График команды'} · {employee.role==='manager'?'Менеджер':'Сотрудник'}</span><button className="text-btn" onClick={()=>{setEmployee(null);setTab('requests')}}><LogOut size={14}/> Выйти</button></footer>
  {toast&&<div className="toast">{toast}</div>}
 </main>;
}
