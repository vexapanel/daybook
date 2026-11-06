-- Run once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Each phone signs in anonymously and can only insert/update its own rows.
-- DELETE is never granted: a delete on the phone arrives here as deleted = true, so nothing is lost.

create table if not exists public.devices (
  user_id uuid primary key,
  name text,
  device text,
  updated_at timestamptz not null default now() -- last time the app was opened
);

create table if not exists public.items (
  user_id uuid not null,
  id text not null,
  kind text not null check (kind in ('notes', 'tx')),
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.devices enable row level security;
alter table public.items enable row level security;

revoke all on public.devices, public.items from anon, authenticated;
grant select, insert, update on public.devices, public.items to authenticated;

drop policy if exists "own rows" on public.devices;
create policy "own rows" on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.items;
create policy "own rows" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Readable list of everything for the dashboard (Table Editor -> entries).
-- security_invoker keeps row level security on, so phones still only see their own rows through it.
create or replace view public.entries with (security_invoker = true) as
select
  d.name,
  d.device,
  i.kind,
  i.data ->> 'date' as date,
  i.data ->> 'time' as time,
  i.data ->> 'type' as type,
  (i.data ->> 'amount')::numeric as amount,
  coalesce(i.data ->> 'text', i.data ->> 'desc') as text,
  i.deleted,
  i.updated_at,
  i.user_id
from public.items i
left join public.devices d using (user_id)
order by i.data ->> 'date' desc, i.data ->> 'time' desc;

revoke all on public.entries from anon, authenticated;
