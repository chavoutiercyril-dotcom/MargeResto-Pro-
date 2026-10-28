-- MARGERESTO : à exécuter UNE FOIS dans Supabase > SQL Editor.
-- Les clés de paiement ne doivent JAMAIS apparaître ici ou dans l'interface publique.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  subscription_status text not null default 'none',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  is_admin boolean not null default false
);

create table if not exists public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) < 1048576),
  updated_at timestamptz not null default now()
);

create or replace function public.update_app_data_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_data_timestamp on public.app_data;
create trigger set_app_data_timestamp before update on public.app_data
for each row execute function public.update_app_data_timestamp();

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_margeresto on auth.users;
create trigger on_auth_user_created_margeresto
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

-- Si l'authentification a déjà été testée AVANT l'installation du déclencheur :
insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.app_data enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.app_data from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.app_data to authenticated;

drop policy if exists "Le client voit son profil" on public.profiles;
create policy "Le client voit son profil" on public.profiles
for select to authenticated using (id = (select auth.uid()));

-- Vérification d'un essai en cours OU d'un abonnement en cours dans la base,
-- pas uniquement par une interface JavaScript facile à contourner.
drop policy if exists "Donnees uniquement si droit d'acces valide" on public.app_data;
create policy "Donnees uniquement si droit d'acces valide" on public.app_data
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid())
      and (p.is_admin or p.trial_ends_at > now() or p.subscription_status in ('active','trialing'))
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid())
      and (p.is_admin or p.trial_ends_at > now() or p.subscription_status in ('active','trialing'))
  )
);

-- Pour définir le propriétaire comme administrateur, remplacer l'e-mail :
-- update public.profiles set is_admin = true where email = 'votre-email@exemple.fr';

-- Le compte service_role (côté Netlify uniquement) met à jour les abonnements.
-- NE JAMAIS créer une règle permettant aux clients de modifier profiles.is_admin,
-- subscription_status, trial_ends_at ou stripe_customer_id.
