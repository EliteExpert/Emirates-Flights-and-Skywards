create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('departure', 'arrival')),
  flight_date date not null,
  flight_number text not null,
  airline text not null default 'Emirates PTFS',
  departure_time time,
  arrival_time time,
  destination text not null,
  aircraft text not null,
  terminal text not null,
  status text not null check (status in ('Check-in Open', 'Boarding', 'Final Call', 'Gate Closed', 'Delayed', 'Cancelled', 'Departed', 'In Flight', 'Arrived')),
  discord_event text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departure_has_time check ((type = 'departure' and departure_time is not null and arrival_time is null) or (type = 'arrival' and arrival_time is not null and departure_time is null)),
  constraint flight_identity unique (type, flight_date, flight_number)
);

alter table public.flights enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flights_set_updated_at on public.flights;
create trigger flights_set_updated_at
before update on public.flights
for each row execute function public.set_updated_at();

create table if not exists public.weekly_announcements (
  week_start date primary key,
  posted_at timestamptz not null default now()
);

alter table public.weekly_announcements enable row level security;

alter table public.flights add column if not exists ptfs_departure text;
alter table public.flights add column if not exists ptfs_arrival text;
