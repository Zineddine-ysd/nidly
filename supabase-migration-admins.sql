-- Migration idempotente pour la table "admins" (comptes du panel admin Nidly)
-- À exécuter une seule fois dans l'éditeur SQL de Supabase (Dashboard > SQL Editor).
-- Sans danger si la table existe déjà : les IF NOT EXISTS empêchent d'écraser tes données.

create table if not exists admins (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Si la table existait déjà mais sans certaines colonnes (ex: created_at ajouté après coup),
-- ces lignes les ajoutent sans toucher aux données existantes.
alter table admins add column if not exists created_at timestamptz not null default now();
