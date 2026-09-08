alter table public.flights
  drop constraint if exists flights_status_check;

alter table public.flights
  add constraint flights_status_check
  check (status in (
    'Check-in Open', 'Boarding', 'Final Call', 'Gate Closed',
    'Delayed', 'Cancelled', 'Departed', 'In Flight', 'Arrived'
  ));
