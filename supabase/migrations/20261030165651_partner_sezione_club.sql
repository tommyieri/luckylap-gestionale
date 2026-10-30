-- Sezione «Club» del modulo Partner: Porsche Club fuori dall'Italia, club Ferrari e Mercedes.
-- Additiva: allarga il vincolo delle sezioni di public.partners e la funzione che le valida
-- (comandi del team e import della ricerca). Nessun dato cambia, nessun grant nuovo.

-- Il vincolo nasce inline nella colonna (20261022215908_partner_module): nome di PostgreSQL
-- partners_sections_check. Un CHECK non ammette sottoquery: le sezioni distinte si controllano
-- a coppie, come prima, fino a quattro.
alter table public.partners drop constraint partners_sections_check;
alter table public.partners add constraint partners_sections_check check (
  array_ndims(sections) = 1 and array_lower(sections, 1) = 1
  and cardinality(sections) between 1 and 4
  and sections <@ array['vendita', 'eventi', 'collab', 'club']::text[]
  and (cardinality(sections) < 2 or sections[1] <> sections[2])
  and (cardinality(sections) < 3 or (sections[1] <> sections[3] and sections[2] <> sections[3]))
  and (cardinality(sections) < 4
    or (sections[1] <> sections[4] and sections[2] <> sections[4] and sections[3] <> sections[4]))
);

-- Sezioni distinte, da 1 a 4, nell'ordine canonico vendita, eventi, collab, club. Stessa firma:
-- create or replace conserva proprietario e permessi (nessun EXECUTE ai ruoli client).
create or replace function private.partner_sections(v jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare r text[];
begin
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and 4
    or exists (select 1 from jsonb_array_elements(v) e
      where jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('vendita', 'eventi', 'collab', 'club'))
    or (select count(distinct e #>> '{}') from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  select array_agg(s order by array_position(array['vendita', 'eventi', 'collab', 'club']::text[], s)) into r
    from (select e #>> '{}' s from jsonb_array_elements(v) e) x;
  return r;
end
$$;
