-- CÚBICO · Setup de base de datos: perfiles, casilleros automáticos y paquetes
-- Ejecutar una sola vez en Supabase > SQL Editor > Run.

-- ── EXTENSIONES ────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

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
  role                text        not null default 'client' check (role in ('client', 'admin')),
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

-- Genera un código basado en el nombre del usuario: CBC-NombreApellido
-- Si ya existe ese código, agrega un sufijo de 2 caracteres aleatorios: CBC-NombreApellido-XY
-- Si primer + apellido producen una cadena vacía (solo caracteres especiales), genera CBC-XXXXXX aleatorio.
create or replace function public.make_name_code(p_first text, p_last text)
returns text
language plpgsql
as $$
declare
  base_name text;
  base_code text;
  candidate text;
  suffix    text;
  chars     text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
begin
  -- Quitar caracteres no alfanuméricos y truncar a 16 chars
  base_name := left(regexp_replace(p_first || p_last, '[^a-zA-Z0-9]', '', 'g'), 16);

  -- Fallback aleatorio si el nombre no aporta caracteres válidos
  if base_name = '' then
    loop
      candidate := 'CBC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.profiles where cbc_code = candidate);
    end loop;
    return candidate;
  end if;

  base_code := 'CBC-' || base_name;

  -- Intentar el código base sin sufijo
  if not exists (select 1 from public.profiles where cbc_code = base_code) then
    return base_code;
  end if;

  -- Si ya existe, agregar sufijo separado por guion hasta encontrar uno libre
  loop
    suffix := substr(chars, floor(random() * 36)::int + 1, 1) ||
              substr(chars, floor(random() * 36)::int + 1, 1);
    candidate := base_code || '-' || suffix;
    exit when not exists (select 1 from public.profiles where cbc_code = candidate);
  end loop;

  return candidate;
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
    case
      -- Usar el código del frontend si viene y no está tomado
      when nullif(new.raw_user_meta_data->>'cbc_code', '') is not null
           and not exists (select 1 from public.profiles where cbc_code = new.raw_user_meta_data->>'cbc_code')
      then new.raw_user_meta_data->>'cbc_code'
      -- Si colisiona o no viene, generar basado en nombre
      else public.make_name_code(
        coalesce(nullif(new.raw_user_meta_data->>'first_name', ''), 'cliente'),
        coalesce(nullif(new.raw_user_meta_data->>'last_name', ''), '')
      )
    end,
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

-- profiles: lectura
drop policy if exists "clients read own profile" on public.profiles;
create policy "clients read own profile" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

-- profiles: actualización (solo el propio usuario)
drop policy if exists "clients update own profile" on public.profiles;
create policy "clients update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- profiles: inserción (solo el propio usuario; el trigger usa security definer y bypasea RLS)
drop policy if exists "clients insert own profile" on public.profiles;
create policy "clients insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- packages: lectura (propio cliente o admin)
drop policy if exists "clients read own packages" on public.packages;
create policy "clients read own packages" on public.packages
  for select using (auth.uid() = client_id or public.is_admin());

-- packages: gestión completa solo para admins (insert, update, delete)
drop policy if exists "admins manage packages" on public.packages;
create policy "admins manage packages" on public.packages
  for all using (public.is_admin()) with check (public.is_admin());

