-- CÚBICO · Setup de base de datos: perfiles, casilleros automáticos y paquetes
-- Ejecutar una sola vez en Supabase > SQL Editor > Run.

-- ── EXTENSIONES ────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── SECUENCIA: CONTADOR ÚNICO DE CASILLEROS ────────────────────────────────────

-- Genera números únicos y crecientes para los códigos CBC.
-- Formato final del código: CBC10001-NombreApellido
create sequence if not exists public.cbc_counter start 10001 increment 1;

-- ── TABLAS ─────────────────────────────────────────────────────────────────────

-- Formatos de cédula aceptados:
--   Regular:                 1-1234-12345   (provincia-tomo-número)
--   Nacido en el extranjero: PE-1234-12345
--   Extranjero con cédula:   E-1234-123456
create table if not exists public.profiles (
  id                  uuid        not null primary key references auth.users(id) on delete cascade,
  first_name          text        not null default '',
  last_name           text        not null default '',
  cedula              text        not null unique
                                  check (cedula ~ '^\d{1,2}-\d{1,4}-\d{1,5}$|^PE-\d{1,4}-\d{1,5}$|^E-\d{1,4}-\d{1,6}$'),
  phone               text        not null default '',
  email               text        not null default '',
  address             text        not null default '',
  zone                text,                              -- opcional: ciudad o área adicional
  delivery_preference text        not null default 'Retiro coordinado',
  cbc_code            text        unique,                -- asignado por el trigger; null solo durante el insert
  role                text        not null default 'client' check (role in ('client', 'admin', 'repartidor')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.packages (
  id              uuid        not null primary key default gen_random_uuid(),
  client_id       uuid        not null references public.profiles(id) on delete cascade,
  tracking_number text        not null unique,
  description     text,                                  -- opcional: descripción del contenido
  status          text        not null default 'Recibido en Miami',
  shipping_type   text        not null default 'Aéreo',
  amount_due      numeric     not null default 0,
  payment_status  text        not null default 'Pendiente',
  created_at      timestamptz not null default now()
);

-- ── ÍNDICES ────────────────────────────────────────────────────────────────────

-- Acelera las consultas de paquetes por cliente (usado en el portal del cliente y admin)
create index if not exists idx_packages_client_id on public.packages(client_id);

-- ── FUNCIONES DE GENERACIÓN DE CÓDIGO CBC ──────────────────────────────────────

-- Genera un código con número secuencial + nombre: CBC10001-NombreApellido
-- El número proviene de cbc_counter (único y creciente; garantiza sin colisiones).
-- Si nombre+apellido no aportan caracteres alfanuméricos, usa "Cliente" como base.
create or replace function public.make_name_code(p_first text, p_last text)
returns text
language plpgsql
as $$
declare
  seq_num   bigint;
  name_part text;
begin
  seq_num   := nextval('public.cbc_counter');
  name_part := left(regexp_replace(p_first || p_last, '[^a-zA-Z0-9]', '', 'g'), 30);

  if name_part = '' then
    name_part := 'Cliente';
  end if;

  return 'CBC' || seq_num::text || '-' || name_part;
end;
$$;

-- ── TRIGGER: CREAR PERFIL AL REGISTRARSE ───────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, first_name, last_name, cedula, phone, email,
    address, zone, delivery_preference, cbc_code, role
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'cedula', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.email, new.raw_user_meta_data->>'email', ''),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'zone', ''),
    coalesce(new.raw_user_meta_data->>'delivery_preference', ''),
    public.make_name_code(
      coalesce(nullif(new.raw_user_meta_data->>'first_name', ''), 'cliente'),
      coalesce(nullif(new.raw_user_meta_data->>'last_name', ''), '')
    ),
    'client'
  )
  on conflict (id) do update set
    first_name          = excluded.first_name,
    last_name           = excluded.last_name,
    cedula              = coalesce(public.profiles.cedula, excluded.cedula),
    phone               = excluded.phone,
    email               = excluded.email,
    address             = excluded.address,
    zone                = excluded.zone,
    delivery_preference = excluded.delivery_preference,
    -- Preservar el código CBC existente si ya tiene uno asignado
    cbc_code            = coalesce(public.profiles.cbc_code, excluded.cbc_code),
    updated_at          = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── FUNCIÓN AUXILIAR PARA RLS (evita recursión en las políticas) ───────────────

-- Usar una función security definer es el patrón recomendado por Supabase para
-- verificar roles desde dentro de las políticas RLS sin causar recursión.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.packages enable row level security;

-- ── FUNCIÓN AUXILIAR PARA REPARTIDORES ────────────────────────────────────────

create or replace function public.is_repartidor()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'repartidor'
  );
$$;

-- profiles: lectura (propio usuario, admin o repartidor)
drop policy if exists "clients read own profile" on public.profiles;
create policy "clients read own profile" on public.profiles
  for select using (auth.uid() = id or public.is_admin() or public.is_repartidor());

-- profiles: actualización (solo el propio usuario)
drop policy if exists "clients update own profile" on public.profiles;
create policy "clients update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- profiles: actualización por admin (cualquier perfil)
drop policy if exists "admins update any profile" on public.profiles;
create policy "admins update any profile" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- profiles: eliminación por admin
drop policy if exists "admins delete any profile" on public.profiles;
create policy "admins delete any profile" on public.profiles
  for delete using (public.is_admin());

-- profiles: inserción (solo el propio usuario; el trigger usa security definer y bypasea RLS)
drop policy if exists "clients insert own profile" on public.profiles;
create policy "clients insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- packages: lectura (propio cliente, admin o repartidor)
drop policy if exists "clients read own packages" on public.packages;
create policy "clients read own packages" on public.packages
  for select using (auth.uid() = client_id or public.is_admin() or public.is_repartidor());

-- packages: gestión completa solo para admins (insert, update, delete)
drop policy if exists "admins manage packages" on public.packages;
create policy "admins manage packages" on public.packages
  for all using (public.is_admin()) with check (public.is_admin());

-- packages: repartidor puede actualizar el estado (solo status; enforced en app)
drop policy if exists "repartidor update packages" on public.packages;
create policy "repartidor update packages" on public.packages
  for update using (public.is_repartidor()) with check (public.is_repartidor());

