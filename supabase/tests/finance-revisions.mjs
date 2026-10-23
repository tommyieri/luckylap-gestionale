// test-db: pglite minimo 72
// Synthetic-only SQL/RLS/CAS tests; no cloud or credential input.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  setupRevisionDatabase,
  asRevisionUser,
  sourceIds,
  orderId,
  externalOrderId,
  users,
  session,
  id,
  payload,
  values,
} from "./fixtures/finance-revisions.mjs";
const core = pathToFileURL(process.argv[2]);
const { PGlite } = await import(core.href),
  { pgcrypto } = await import(new URL("./contrib/pgcrypto.js", core).href);
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
const equal = (a, b, label) => {
  assert.deepEqual(a, b, label);
  checks++;
};
const check = (a, label) => {
  assert.ok(a, label);
  checks++;
};
async function reject(action, message, code = "22023") {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected ${message}`);
  assert.equal(caught.message, message, `Reject ${message}`);
  assert.equal(caught.code, code);
  checks++;
}
const rpc = (p, operation = randomUUID(), role = "finance") =>
  asRevisionUser(
    db,
    role,
    async () =>
      (
        await db.query("select public.revise_finance_movement($1,$2::jsonb) result", [
          operation,
          JSON.stringify(p),
        ])
      ).rows[0].result,
  );
const summary = () =>
  asRevisionUser(
    db,
    "logistics",
    async () =>
      (
        await db.query("select public.read_sales_effective_payments($1::uuid[]) result", [
          [orderId],
        ])
      ).rows[0].result[0],
  );
try {
  await db.exec("create schema extensions;create extension pgcrypto with schema extensions;");
  const fixture = await setupRevisionDatabase(db);
  const operation = randomUUID(),
    first = await rpc(payload("payment", { values: values({ account: "cash" }) }), operation);
  equal(first.version, 1, "first CAS from original");
  equal(
    (
      await db.query(
        "select value_snapshot->>'account' account from public.finance_revision_current where source_kind='payment' and source_id=$1",
        [sourceIds.payment],
      )
    ).rows[0].account,
    "Cash",
    "a direct database correction uses the same Cash account as the dashboard",
  );
  equal((await summary()).amount_due_cents, "5000", "corrected payment creates actual residual");
  equal(
    (await summary()).payment_state,
    "partially_paid",
    "partial state matches effective amount",
  );
  equal(
    (
      await db.query("select amount_cents::text amount from public.order_payments where id=$1", [
        sourceIds.payment,
      ])
    ).rows[0].amount,
    "10000",
    "source is immutable",
  );
  equal(await rpc(payload(), operation), { ...first, replayed: true }, "exact frozen retry");
  await reject(
    () => rpc(payload("payment", { values: values({ amount_cents: 5001 }) }), operation),
    "idempotency_conflict",
  );
  await reject(() => rpc(payload(), operation, "founder"), "idempotency_conflict");
  await reject(() => rpc(payload()), "finance_revision_conflict");
  const paid = await asRevisionUser(
    db,
    "logistics",
    async () =>
      (
        await db.query("select public.record_manual_payment($1,$2::jsonb) result", [
          randomUUID(),
          JSON.stringify({
            order_id: orderId,
            amount_cents: 5000,
            method: "cash",
            occurred_at: new Date(Date.now() - 5000).toISOString(),
          }),
        ])
      ).rows[0].result,
  );
  equal(paid.payment_state, "paid", "residual can be paid once");
  equal((await summary()).amount_due_cents, "0", "no residual after second payment");
  await reject(
    () =>
      asRevisionUser(db, "logistics", () =>
        db.query("select public.record_manual_payment($1,$2::jsonb)", [
          randomUUID(),
          JSON.stringify({
            order_id: orderId,
            amount_cents: 5000,
            method: "cash",
            occurred_at: new Date(Date.now() - 5000).toISOString(),
          }),
        ]),
      ),
    "payment_already_recorded",
  );
  const gone = await rpc({
    schema_version: 1,
    source_kind: "payment",
    source_id: sourceIds.payment,
    expected_version: 1,
    action: "delete",
    reason: "Synthetic deleted",
  });
  equal(gone.version, 2, "recoverable deletion");
  equal((await summary()).amount_due_cents, "5000", "void does not leave paid false state");
  await rpc({
    schema_version: 1,
    source_kind: "payment",
    source_id: sourceIds.payment,
    expected_version: 2,
    action: "restore",
    restore_version: 0,
    reason: "Synthetic restored",
  });
  equal(
    (await summary()).refund_due_cents,
    "5000",
    "restoration after second payment exposes overpayment",
  );
  equal((await summary()).amount_due_cents, "0", "overpayment not negative debt");
  for (const role of ["logistics", "consultant", "inactive", "production_no_flag", "outsider"])
    await reject(
      () => rpc(payload("manual"), randomUUID(), role),
      "finance_access_required",
      "42501",
    );
  equal(
    (await db.query("select count(*)::int n from public.stock_movements")).rows[0].n,
    fixture.stockBefore,
    "no stock effects",
  );
  equal(
    (await db.query("select count(*)::int n from public.finance_movement_revisions")).rows[0].n,
    3,
    "exactly three revisions after replays/rejections",
  );

  // Complete source validation and full snapshots, not arbitrary synthetic origins.
  await reject(() => rpc(payload("manual", { source_id: id(999) })), "finance_source_not_found");
  await reject(
    () => rpc({ ...payload(), source_kind: "shop_payment" }),
    "invalid_finance_revision",
  );
  await reject(
    () => rpc({ ...payload("manual"), source_id: sourceIds.payment }),
    "finance_source_not_found",
  );
  for (const bad of [
    values({ date: "2026-02-30" }),
    values({ amount_cents: 0.1 }),
    values({ amount_cents: -1 }),
    values({ amount_cents: 9000000000000001 }),
    values({ pending: "true" }),
    values({ target_account: "Another account" }),
    { ...values(), extra: true },
  ])
    await reject(() => rpc(payload("manual", { values: bad })), "invalid_finance_revision");
  const originalBudget = (
    await db.query("select raw_record from public.finance_import_transactions where id=$1", [
      sourceIds.budgetflow,
    ])
  ).rows[0].raw_record;
  await reject(
    () =>
      rpc(payload("budgetflow", { values: values({ account: "Cash", target_account: "cash" }) })),
    "invalid_finance_revision",
  );
  await rpc(
    payload("budgetflow", {
      values: values({
        direction: "expense",
        amount_cents: 101,
        account: " revolut business ",
        target_account: "cash",
        category: "Software",
      }),
    }),
  );
  equal(
    (
      await db.query(
        "select value_snapshot->>'account' account,value_snapshot->>'target_account' target from public.finance_revision_current where source_kind='budgetflow' and source_id=$1",
        [sourceIds.budgetflow],
      )
    ).rows[0],
    { account: "Revolut Business", target: "Cash" },
    "database normalizes only established aliases before storing the effective snapshot",
  );
  const aliasOperation = randomUUID(),
    aliasPayload = payload("budgetflow", {
      expected_version: 1,
      values: values({ account: "Custom bank", target_account: "custom bank" }),
    }),
    customReceipt = await rpc(aliasPayload, aliasOperation);
  equal(
    (
      await db.query(
        "select value_snapshot->>'account' account,value_snapshot->>'target_account' target from public.finance_revision_current where source_kind='budgetflow' and source_id=$1",
        [sourceIds.budgetflow],
      )
    ).rows[0],
    { account: "Custom bank", target: "custom bank" },
    "arbitrary account spelling remains unchanged",
  );
  equal(
    await rpc(aliasPayload, aliasOperation),
    { ...customReceipt, replayed: true },
    "canonical account normalization preserves frozen exact retry",
  );
  equal(
    (
      await db.query("select raw_record from public.finance_import_transactions where id=$1", [
        sourceIds.budgetflow,
      ])
    ).rows[0].raw_record,
    originalBudget,
    "BudgetFlow raw record unchanged",
  );
  await rpc(
    payload("manual", {
      values: values({ direction: "expense", amount_cents: 901, category: "Software" }),
    }),
    randomUUID(),
    "production",
  );
  await reject(
    () =>
      asRevisionUser(db, "finance", () =>
        db.query("select public.void_finance_entry($1,$2::jsonb)", [
          randomUUID(),
          JSON.stringify({
            schema_version: 1,
            entry_id: sourceIds.manual,
            reason: "Synthetic legacy blocked",
          }),
        ]),
      ),
    "use_finance_revisions",
  );
  await rpc({
    schema_version: 1,
    source_kind: "manual",
    source_id: sourceIds.manual,
    expected_version: 1,
    action: "delete",
    reason: "Synthetic delete",
  });
  await reject(() => rpc(payload("manual", { expected_version: 2 })), "finance_movement_deleted");
  await rpc({
    schema_version: 1,
    source_kind: "manual",
    source_id: sourceIds.manual,
    expected_version: 2,
    action: "restore",
    restore_version: 0,
    reason: "Synthetic restore original",
  });
  equal(
    (
      await db.query(
        "select value_snapshot->>'amount_cents' amount,deleted from public.finance_revision_current where source_kind='manual' and source_id=$1",
        [sourceIds.manual],
      )
    ).rows[0],
    { amount: "123", deleted: false },
    "restore exact immutable original",
  );
  await rpc(
    payload("manual", { expected_version: 3, values: values({ amount_cents: 0 }) }),
    randomUUID(),
    "founder",
  );
  equal(
    (
      await db.query(
        "select value_snapshot->>'amount_cents' amount from public.finance_revision_current where source_kind='manual' and source_id=$1",
        [sourceIds.manual],
      )
    ).rows[0].amount,
    "0",
    "zero source corrections supported",
  );
  // Existing legacy voids remain immutable yet can be restored through P4.
  await db.query(
    "insert into public.finance_entries(id,entry_date,entry_type,amount_eur,description,created_by)values($1,'2026-03-17','expense',2.34,'Synthetic already voided',$2)",
    [id(104), users.finance],
  );
  const legacyOp = randomUUID(),
    legacyVoidPayload = { schema_version: 1, entry_id: id(104), reason: "Synthetic legacy void" };
  const legacyVoid = await asRevisionUser(
    db,
    "finance",
    async () =>
      (
        await db.query("select public.void_finance_entry($1,$2::jsonb) result", [
          legacyOp,
          JSON.stringify(legacyVoidPayload),
        ])
      ).rows[0].result,
  );
  await rpc({
    schema_version: 1,
    source_kind: "manual",
    source_id: id(104),
    expected_version: 0,
    action: "restore",
    restore_version: 0,
    reason: "Synthetic revive legacy",
  });
  equal(
    (
      await db.query(
        "select deleted from public.finance_revision_current where source_kind='manual' and source_id=$1",
        [id(104)],
      )
    ).rows[0].deleted,
    false,
    "restore source previously voided",
  );
  equal(
    await asRevisionUser(
      db,
      "finance",
      async () =>
        (
          await db.query("select public.void_finance_entry($1,$2::jsonb) result", [
            legacyOp,
            JSON.stringify(legacyVoidPayload),
          ])
        ).rows[0].result,
    ),
    { ...legacyVoid, replayed: true },
    "legacy receipt recovers after P4 overlay",
  );
  // Old consignment: corrected paid amount drives remaining claim, no stock/pricing effects.
  const legacySummary = () =>
    asRevisionUser(
      db,
      "finance",
      async () =>
        (
          await db.query(
            "select public.read_effective_consignment_settlements($1::uuid[]) result",
            [[id(222)]],
          )
        ).rows[0].result[0],
    );
  await rpc(payload("consignment_settlement", { values: values({ amount_cents: 500 }) }));
  equal((await legacySummary()).amount_due_cents, "6100", "legacy corrected residual");
  const settlementPayload = {
    schema_version: 1,
    sale_id: id(222),
    amount_cents: 6100,
    occurred_at: new Date(Date.now() - 5000).toISOString(),
    method: "cash",
    reference: "SYN-RESIDUAL",
  };
  const settlementOp = randomUUID();
  const settled = await asRevisionUser(
    db,
    "finance",
    async () =>
      (
        await db.query("select public.record_consignment_settlement($1,$2::jsonb) result", [
          settlementOp,
          JSON.stringify(settlementPayload),
        ])
      ).rows[0].result,
  );
  equal((await legacySummary()).amount_due_cents, "0", "legacy actual residual accepted");
  equal(
    await asRevisionUser(
      db,
      "finance",
      async () =>
        (
          await db.query("select public.record_consignment_settlement($1,$2::jsonb) result", [
            settlementOp,
            JSON.stringify(settlementPayload),
          ])
        ).rows[0].result,
    ),
    { ...settled, replayed: true },
    "legacy exact retry",
  );
  await reject(
    () =>
      asRevisionUser(db, "finance", () =>
        db.query("select public.record_consignment_settlement($1,$2::jsonb)", [
          randomUUID(),
          JSON.stringify({ ...settlementPayload, amount_cents: 1, reference: "SYN-DUP" }),
        ]),
      ),
    "settlement_exceeds_claim",
  );
  await rpc({
    schema_version: 1,
    source_kind: "consignment_settlement",
    source_id: sourceIds.consignment_settlement,
    expected_version: 1,
    action: "restore",
    restore_version: 0,
    reason: "Synthetic legacy overpayment",
  });
  equal((await legacySummary()).refund_due_cents, "500", "legacy restore exposes overpayment");
  // An uncorrected provider status is not inferred from incomplete observations.
  await db.exec(`create function private.synthetic_canonical_paid()returns void language plpgsql security definer set search_path='' as $$begin
  insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by,source_kind)
  values('${id(240)}','${id(241)}','${"a".repeat(64)}','shopify_web',now()-interval '1 hour',(now()-interval '1 hour')at time zone 'Europe/Rome',10000,'paid','prepare','unfulfilled',null,'shopify_canonical');end$$;
  revoke all on function private.synthetic_canonical_paid()from public,anon,authenticated;grant execute on function private.synthetic_canonical_paid()to service_role;
  begin;set local role service_role;select private.synthetic_canonical_paid();commit;drop function private.synthetic_canonical_paid();`);
  const canonicalPaid = await asRevisionUser(
    db,
    "logistics",
    async () =>
      (
        await db.query("select public.read_sales_effective_payments($1::uuid[]) result", [
          [id(240)],
        ])
      ).rows[0].result[0],
  );
  equal(canonicalPaid.payment_state, "paid", "uncorrected canonical paid remains authoritative");
  equal(canonicalPaid.amount_due_cents, null, "no fabricated residual from missing observations");
  equal(
    canonicalPaid.corrected,
    false,
    "provider status remains separate from internal correction",
  );
  // Shopify observations retain their provider identity and status after correction.
  await rpc(payload("payment", { source_id: id(212), values: values({ amount_cents: 5000 }) }));
  await rpc(
    payload("refund", {
      values: values({ direction: "expense", amount_cents: 1000, account: null }),
    }),
  );
  const externalSummary = () =>
    asRevisionUser(
      db,
      "logistics",
      async () =>
        (
          await db.query("select public.read_sales_effective_payments($1::uuid[]) result", [
            [externalOrderId],
          ])
        ).rows[0].result[0],
    );
  equal(
    (await externalSummary()).amount_due_cents,
    "16000",
    "external internal projection uses corrected receipt/refund",
  );
  equal(
    (
      await db.query("select amount_cents::text amount from public.order_payments where id=$1", [
        id(212),
      ])
    ).rows[0].amount,
    "10000",
    "provider capture remains original",
  );
  await db.exec(`create function private.synthetic_next_capture()returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.order_payments(id,operation_id,order_id,source_kind,method,amount_cents,occurred_at,created_by)values('${id(230)}','${id(231)}','${externalOrderId}','shopify_observation','shopify_observed',5000,now()-interval '1 minute',null)on conflict(id)do nothing;
 update public.sales_orders set payment_state='partially_refunded' where id='${externalOrderId}';end$$;revoke all on function private.synthetic_next_capture()from public,anon,authenticated;grant execute on function private.synthetic_next_capture()to service_role;
 begin;set local role service_role;select private.synthetic_next_capture();select private.synthetic_next_capture();commit;drop function private.synthetic_next_capture();`);
  equal(
    (await externalSummary()).amount_due_cents,
    "11000",
    "new observation added exactly once without erasing override",
  );
  equal(
    (
      await db.query(
        "select version from public.finance_revision_current where source_kind='payment' and source_id=$1",
        [id(212)],
      )
    ).rows[0].version,
    1,
    "source replay does not replace overlay",
  );
  const safe = await externalSummary();
  check(
    !["net_cents", "incoming_cents", "account", "reference", "values"].some((key) =>
      Object.hasOwn(safe, key),
    ),
    "operational DTO omits Finance details",
  );
  // RLS, privilege and current session revocation are checked again on every call.
  for (const role of ["logistics", "consultant", "inactive", "production_no_flag", "outsider"])
    equal(
      await asRevisionUser(
        db,
        role,
        async () =>
          (await db.query("select count(*)::int n from public.finance_movement_revisions")).rows[0]
            .n,
      ),
      0,
      "RLS denies protected revision rows",
    );
  for (const operation of [
    "update public.finance_movement_revisions set reason=reason",
    "delete from public.finance_movement_revisions",
    "select * from private.finance_revision_receipts",
    "select private.finance_revision_original('manual',$1)",
  ]) {
    await assert.rejects(
      () =>
        asRevisionUser(db, "finance", () =>
          db.query(operation, operation.includes("$1") ? [sourceIds.manual] : []),
        ),
      (error) => error.code === "42501",
    );
    checks++;
  }
  await assert.rejects(
    () =>
      asRevisionUser(
        db,
        "finance",
        () =>
          db.query("select public.revise_finance_movement($1,$2::jsonb)", [
            randomUUID(),
            JSON.stringify(payload("budgetflow", { expected_version: 1 })),
          ]),
        { databaseRole: "service_role" },
      ),
    (error) => error.code === "42501",
  );
  checks++;
  await db.query(
    "update private.area_grants set expires_at=now()-interval '1 second' where user_id=$1",
    [users.finance],
  );
  await reject(() => rpc(payload(), operation), "finance_access_required", "42501");
  await db.query(
    "update private.area_grants set expires_at=now()+interval '8 hours' where user_id=$1",
    [users.finance],
  );
  await assert.rejects(
    () =>
      asRevisionUser(
        db,
        "finance",
        () =>
          db.query("select public.revise_finance_movement($1,$2::jsonb)", [
            operation,
            JSON.stringify(payload()),
          ]),
        { sid: id(999) },
      ),
    (error) => error.message === "finance_access_required",
  );
  checks++;
  await db.query("delete from auth.sessions where id=$1", [session("finance")]);
  await reject(() => rpc(payload(), operation), "finance_access_required", "42501");
  await db.query("insert into auth.sessions(id,user_id)values($1,$2)", [
    session("finance"),
    users.finance,
  ]);
  await db.query("update public.memberships set active=false where user_id=$1", [users.finance]);
  await reject(() => rpc(payload(), operation), "finance_access_required", "42501");
  await db.query("update public.memberships set active=true where user_id=$1", [users.finance]);
  equal(
    (await db.query("select count(*)::int n from public.stock_movements")).rows[0].n,
    fixture.stockBefore,
    "all revisions leave stock untouched",
  );
  console.log(`PASS ${checks} Finance revisions controlli superati (PGlite, Auth simulato).`);
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, where: error.where }));
  process.exitCode = 1;
} finally {
  await db.close();
}
