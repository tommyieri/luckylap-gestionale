// test-db: pglite minimo 15
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.argv[2]));
const db = new PGlite();
const founder = "92000000-0000-4000-8000-000000000001";
const colleague = "92000000-0000-4000-8000-000000000002";
const month = "2028-02-01";
let checks = 0;
function equal(actual, expected) {
  assert.deepEqual(actual, expected);
  checks++;
}
async function rejects(callback, predicate) {
  await assert.rejects(callback, predicate);
  checks++;
}

async function authenticated(actor, aal, run) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, aal }),
    ]);
    await db.exec("set local role authenticated");
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

function save(category, limit, revision = null, actor = founder, session = founder, day = month) {
  return authenticated(session, "aal2", () =>
    db.query("select public.save_finance_budget($1,$2,$3,$4,$5)", [
      day,
      category,
      limit,
      revision,
      actor,
    ]),
  );
}

async function list(actor = founder, aal = "aal2") {
  return authenticated(
    actor,
    aal,
    async () =>
      (
        await db.query(
          "select category, limit_cents as limit, revision from public.finance_budgets order by category",
        )
      ).rows,
  );
}

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const migration of ["20261021114636_initial_schema", "20261113195300_finance_budget"]) {
    await db.exec(
      await readFile(new URL(`../migrations/${migration}.sql`, import.meta.url), "utf8"),
    );
  }
  for (const [actor, role, access] of [
    [founder, "founder", true],
    [colleague, "consultant", false],
  ]) {
    await db.query("insert into auth.users values($1)", [actor]);
    await db.query("insert into public.profiles(user_id,display_name) values($1,'Esempio')", [
      actor,
    ]);
    await db.query("insert into public.memberships(user_id,role,finance_access) values($1,$2,$3)", [
      actor,
      role,
      access,
    ]);
  }

  equal(await list(), []);
  await rejects(() => save("", 12001, null, founder, colleague), {
    code: "42501",
    message: "finance_access_required",
  });
  await rejects(() => save("", 12001, null, colleague, colleague), {
    code: "42501",
    message: "finance_access_required",
  });
  await rejects(() => save(" Categoria ", 3000), {
    code: "22023",
    message: "invalid_finance_budget",
  });
  await rejects(() => save("Categoria", 3000, null, founder, founder, "2028-02-02"), {
    code: "22023",
    message: "invalid_finance_budget",
  });
  await rejects(() => save("Categoria", -1), { code: "22023", message: "invalid_finance_budget" });
  await save("", 12001);
  await save("Categoria", 0);
  const initial = await list();
  equal(
    initial.map(({ category, limit }) => [category, Number(limit)]),
    [
      ["", 12001],
      ["Categoria", 0],
    ],
  );
  equal(await list(colleague), []);
  equal(await list(founder, "aal1"), []);
  await save("", 12001);
  equal(await list(), initial);
  await rejects(() => save("", 15001), { code: "40001", message: "finance_budget_changed" });
  await save("", 15001, initial[0].revision);
  const updated = await list();
  equal(Number(updated[0].limit), 15001);
  await save("", 15001, initial[0].revision);
  equal(await list(), updated);
  await rejects(() => save("", null, initial[0].revision), {
    code: "40001",
    message: "finance_budget_changed",
  });
  await save("", null, updated[0].revision);
  await save("", null, updated[0].revision);
  equal(await list(), [initial[1]]);
  await rejects(
    () =>
      authenticated(founder, "aal2", () =>
        db.query("update public.finance_budgets set limit_cents = 7"),
      ),
    /permission denied/i,
  );
  console.log(`PASS ${checks} budget Finance (PGlite).`);
} finally {
  await db.close();
}
