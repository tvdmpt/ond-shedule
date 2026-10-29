-- Extend existing deployments without recreating the project.
create extension if not exists btree_gist;

alter table public.shifts
  add column if not exists is_substitute boolean not null default false,
  add column if not exists substitute_from_location_id uuid references public.locations(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_substitute_source_check') then
    alter table public.shifts add constraint shifts_substitute_source_check
      check ((is_substitute = false and substitute_from_location_id is null)
        or (is_substitute = true and substitute_from_location_id is not null and substitute_from_location_id <> location_id));
  end if;
end $$;

-- Prevent one employee from being scheduled at two locations at overlapping times.
-- If existing rows overlap, resolve them before applying this constraint.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_employee_no_overlap') then
    alter table public.shifts add constraint shifts_employee_no_overlap
      exclude using gist (employee_id with =, tsrange(work_date + starts_at, work_date + ends_at, '[)') with &&);
  end if;
end $$;

-- Replace any previously seeded Monday-only baseline with day-specific weekday/weekend records.
-- Existing manager-customized requirements are not deleted.
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, d.day_of_week, '07:00','15:00',2,'required','Базовый минимум ВК01'
from public.locations l cross join generate_series(1,7) as d(day_of_week)
where l.code='ВК01'
  and not exists (select 1 from public.staffing_requirements r where r.location_id=l.id and r.day_of_week=d.day_of_week and r.starts_at='07:00' and r.ends_at='15:00' and r.kind='required');
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, d.day_of_week, '11:00','15:00',2,'preferred','Дополнительная потребность ВК01 (желательно)'
from public.locations l cross join generate_series(1,5) as d(day_of_week)
where l.code='ВК01'
  and not exists (select 1 from public.staffing_requirements r where r.location_id=l.id and r.day_of_week=d.day_of_week and r.starts_at='11:00' and r.ends_at='15:00' and r.kind='preferred');
insert into public.staffing_requirements(location_id,day_of_week,starts_at,ends_at,required_count,kind,label)
select l.id, d.day_of_week, '15:00','22:00',1,'required','Вечерняя смена ВК01'
from public.locations l cross join generate_series(1,7) as d(day_of_week)
where l.code='ВК01'
  and not exists (select 1 from public.staffing_requirements r where r.location_id=l.id and r.day_of_week=d.day_of_week and r.starts_at='15:00' and r.ends_at='22:00' and r.kind='required');
