-- Calendario Partner 2027: fonti ufficiali e perimetro in docs/partner-calendario-2027.md.
-- Solo date nuove: le undici righe del 2026 e i 39 alias dei nove paesi restano invariati.
-- Le sostituzioni britanniche sono esplicite anche se gia comprese nel blackout natalizio.
begin;

insert into private.partner_assistant_holidays(country_code,day) values
  ('IT','2027-03-29'),('IT','2027-04-25'),('IT','2027-05-01'),('IT','2027-06-02'),
  ('IT','2027-08-15'),('IT','2027-10-04'),('IT','2027-11-01'),('IT','2027-12-08'),
  ('GB','2027-03-26'),('GB','2027-03-29'),('GB','2027-05-03'),('GB','2027-05-31'),
  ('GB','2027-08-30'),('GB','2027-12-27'),('GB','2027-12-28'),
  ('DE','2027-03-26'),('DE','2027-03-29'),('DE','2027-05-01'),('DE','2027-05-06'),
  ('DE','2027-05-17'),('DE','2027-10-03'),
  ('AT','2027-03-29'),('AT','2027-05-01'),('AT','2027-05-06'),('AT','2027-05-17'),
  ('AT','2027-05-27'),('AT','2027-08-15'),('AT','2027-10-26'),('AT','2027-11-01'),('AT','2027-12-08'),
  ('CH','2027-05-06'),('CH','2027-08-01'),
  ('FR','2027-03-29'),('FR','2027-05-01'),('FR','2027-05-06'),('FR','2027-05-08'),
  ('FR','2027-05-17'),('FR','2027-07-14'),('FR','2027-08-15'),('FR','2027-11-01'),('FR','2027-11-11'),
  ('ES','2027-03-26'),('ES','2027-05-01'),('ES','2027-08-15'),('ES','2027-10-12'),
  ('ES','2027-11-01'),('ES','2027-12-06'),('ES','2027-12-08'),
  ('BE','2027-03-29'),('BE','2027-05-01'),('BE','2027-05-06'),('BE','2027-05-17'),
  ('BE','2027-07-21'),('BE','2027-08-15'),('BE','2027-11-01'),('BE','2027-11-11'),
  ('NL','2027-03-26'),('NL','2027-03-29'),('NL','2027-04-27'),('NL','2027-05-05'),
  ('NL','2027-05-06'),('NL','2027-05-17')
on conflict(country_code,day) do nothing;

-- CREATE OR REPLACE conserva identita, proprietario e ACL: nessun nuovo grant.
create or replace function private.partner_assistant_holidays_until() returns date
language sql immutable security invoker set search_path='' as $$
  select date '2027-12-31'
$$;

commit;
