-- Admin read access for the dashboard, the secure way (no secret key in the browser).
--
-- Setup:
-- 1. Supabase dashboard -> Authentication -> Users -> Add user.
--    Email:    yozanylmz1234@gmail.com   (or change it below and here)
--    Password: pick one
--    Tick "Auto Confirm User".
-- 2. Run this file in SQL Editor.
-- 3. Open admin.html, sign in with that email + password.
--
-- The admin only gets to READ every row. Everyone else still sees only their own
-- rows, and the admin cannot write or delete anything through this policy.

drop policy if exists "admin read" on public.items;
create policy "admin read" on public.items for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'yozanylmz1234@gmail.com');

drop policy if exists "admin read" on public.devices;
create policy "admin read" on public.devices for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'yozanylmz1234@gmail.com');
