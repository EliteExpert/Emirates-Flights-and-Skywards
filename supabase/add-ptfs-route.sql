-- Adds the in-game (PTFS) route to each flight so the IFE and boards can
-- show both the simulated and real-world routes. Run once in Supabase SQL.
alter table public.flights add column if not exists ptfs_departure text;
alter table public.flights add column if not exists ptfs_arrival text;
