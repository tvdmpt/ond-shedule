create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create type public.employee_role as enum ('manager','employee');
create type public.request_status as enum ('new','accepted','rejected');
create type public.requirement_kind as enum ('required','preferred');

create table public.employees (
 id uuid primary key default gen_random_uuid(),
 full_name text not null unique,
 role public.employee_role not null default 'employee',
 telegram_user_id bigint unique,
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.locations (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code in ('ВК01','ВК03','ЗИЛ')),
 title text not null
);
create table public.availability_requests (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 week_start date not null,
 status public.request_status not null default 'new',
 comment text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(employee_id, week_start),
 check (extract(isodow from week_start) = 1)
);
create table public.availability_intervals (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.availability_requests(id) on delete cascade,
 work_date date not null,
 starts_at time not null,
 ends_at time not null,
 check (starts_at < ends_at),
 unique(request_id, work_date, starts_at, ends_at)
);
create table public.staffing_requirements (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id) on delete cascade,
 work_date date,
 day_of_week smallint check (day_of_week between 1 and 7),
 starts_at time not null,
 ends_at time not null,
 required_count integer not null check (required_count > 0),
 kind public.requirement_kind not null default 'required',
 label text not null default '',
 created_by uuid references public.employees(id),
 created_at timestamptz not null default now(),
 check (starts_at < ends_at),
 check (work_date is not null or day_of_week is not null)
);
create table public.shifts (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id),
 location_id uuid not null references public.locations(id),
 work_date date not null,
 starts_at time not null,
 ends_at time not null,
 is_substitute boolean not null default false,
 substitute_from_location_id uuid references public.locations(id),
 created_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (starts_at < ends_at),
 check ((is_substitute = false and substitute_from_location_id is null) or (is_substitute = true and substitute_from_location_id is not null and substitute_from_location_id <> location_id) )
);
alter table public.shifts add constraint shifts_employee_no_overlap exclude using gist (employee_id with =, tsrange(work_date + starts_at, work_date + ends_at, '[)') with &&);
create index shifts_date_location_idx on public.shifts(work_date, location_id);
create index shifts_employee_date_idx on public.shifts(employee_id, work_date);
create index availability_week_idx on public.availability_requests(week_start, status);
create index intervals_date_idx on public.availability_intervals(work_date);
create table public.schedule_versions (
 id uuid primary key default gen_random_uuid(),
 week_start date not null,
 version_number integer not null,
 snapshot jsonb not null,
 published_by uuid not null references public.employees(id),
 published_at timestamptz not null default now(),
 exception_confirmed boolean not null default false,
 exception_note text,
 unique(week_start, version_number),
 check (extract(isodow from week_start) = 1)
);
create index schedule_versions_latest_idx on public.schedule_versions(week_start, version_number desc);
create table public.audit_log (
 id bigint generated always as identity primary key,
 actor_id uuid references public.employees(id),
 action text not null,
 entity_type text not null,
 entity_id text,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log(created_at desc);

insert into public.locations(code,title) values ('ВК01','ВК01'),('ВК03','ВК03'),('ЗИЛ','ЗИЛ') on conflict(code) do nothing;
insert into public.employees(full_name,role) values
 ('Дикун Андрей','manager'),('Гриценко Полина','manager'),('Байрамгулова Алсу','employee'),('Греков Владислав','manager'),('Саганджиева Диана','employee'),('Буханцева Екатерина','employee'),('Моисеенко София','employee'),('Дуров Ярослав','employee'),('Карачевцева Екатерина','employee'),('Ким Юлия','employee'),('Дикун Роман','employee') on conflict(full_name) do nothing;
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, days.day_of_week, '07:00','15:00',2,'required','Базовый минимум ВК01'
from public.locations l cross join generate_series(1,7) as days(day_of_week)
where l.code='ВК01' on conflict do nothing;
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, days.day_of_week, '11:00','15:00',2,'preferred','Дополнительная потребность ВК01 (желательно)'
from public.locations l cross join generate_series(1,5) as days(day_of_week)
where l.code='ВК01' on conflict do nothing;
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, days.day_of_week, '15:00','22:00',1,'required','Вечерняя смена ВК01'
from public.locations l cross join generate_series(1,7) as days(day_of_week)
where l.code='ВК01' on conflict do nothing;

-- The Edge Function issues short-lived JWTs whose `sub` is the trusted employees.id.
-- Client-provided employee IDs/roles are not used by policies.
create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path=public
as $$ select id from public.employees where id = nullif(auth.jwt()->>'sub','')::uuid and is_active = true $$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.employees where id = public.current_employee_id() and role='manager' and is_active=true) $$;
create or replace function public.request_deadline_open(p_week_start date) returns boolean
language plpgsql stable as $$
declare tz text := coalesce(current_setting('app.timezone', true), 'Europe/Moscow');
declare deadline_at timestamptz;
begin
 deadline_at := ((p_week_start - 2)::timestamp at time zone tz);
 return now() < deadline_at;
end $$;

alter table public.employees enable row level security;
alter table public.locations enable row level security;
alter table public.availability_requests enable row level security;
alter table public.availability_intervals enable row level security;
alter table public.staffing_requirements enable row level security;
alter table public.shifts enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.audit_log enable row level security;

create policy "employees can see team" on public.employees for select to authenticated using (public.current_employee_id() is not null);
create policy "managers manage employees" on public.employees for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "authenticated see locations" on public.locations for select to authenticated using (public.current_employee_id() is not null);
create policy "managers manage locations" on public.locations for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "own requests or manager reads" on public.availability_requests for select to authenticated using (employee_id=public.current_employee_id() or public.is_manager());
create policy "employees insert own request before deadline" on public.availability_requests for insert to authenticated with check (employee_id=public.current_employee_id() and public.request_deadline_open(week_start));
create policy "employees update own request before deadline" on public.availability_requests for update to authenticated using ((employee_id=public.current_employee_id() and public.request_deadline_open(week_start)) or public.is_manager()) with check ((employee_id=public.current_employee_id() and public.request_deadline_open(week_start)) or public.is_manager());
create policy "managers delete requests" on public.availability_requests for delete to authenticated using (public.is_manager());
create policy "read request intervals" on public.availability_intervals for select to authenticated using (exists(select 1 from public.availability_requests r where r.id=request_id and (r.employee_id=public.current_employee_id() or public.is_manager())));
create policy "write own intervals before deadline" on public.availability_intervals for insert to authenticated with check (exists(select 1 from public.availability_requests r where r.id=request_id and ((r.employee_id=public.current_employee_id() and public.request_deadline_open(r.week_start)) or public.is_manager())));
create policy "update own intervals before deadline" on public.availability_intervals for update to authenticated using (exists(select 1 from public.availability_requests r where r.id=request_id and ((r.employee_id=public.current_employee_id() and public.request_deadline_open(r.week_start)) or public.is_manager()))) with check (exists(select 1 from public.availability_requests r where r.id=request_id and ((r.employee_id=public.current_employee_id() and public.request_deadline_open(r.week_start)) or public.is_manager())));
create policy "delete own intervals before deadline" on public.availability_intervals for delete to authenticated using (exists(select 1 from public.availability_requests r where r.id=request_id and ((r.employee_id=public.current_employee_id() and public.request_deadline_open(r.week_start)) or public.is_manager())));
create policy "read requirements" on public.staffing_requirements for select to authenticated using (public.current_employee_id() is not null);
create policy "managers manage requirements" on public.staffing_requirements for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "published schedule available to team" on public.schedule_versions for select to authenticated using (public.current_employee_id() is not null);
create policy "managers publish schedule" on public.schedule_versions for insert to authenticated with check (public.is_manager() and published_by=public.current_employee_id());
create policy "team sees published shifts" on public.shifts for select to authenticated using (public.current_employee_id() is not null);
create policy "managers manage shifts" on public.shifts for all to authenticated using (public.is_manager()) with check (public.is_manager() and created_by=public.current_employee_id());
create policy "managers read audit log" on public.audit_log for select to authenticated using (public.is_manager());
create policy "managers append audit log" on public.audit_log for insert to authenticated with check (public.is_manager() and actor_id=public.current_employee_id());

-- Audit changes to shift rows. Publication snapshots should be inserted by the server-side publish endpoint.
create or replace function public.audit_shift_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
 values(public.current_employee_id(), lower(tg_op), 'shift', coalesce(new.id,old.id)::text,
 jsonb_build_object('old',case when tg_op='INSERT' then null else to_jsonb(old) end,'new',case when tg_op='DELETE' then null else to_jsonb(new) end));
 if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger shifts_audit after insert or update or delete on public.shifts for each row execute function public.audit_shift_change();
