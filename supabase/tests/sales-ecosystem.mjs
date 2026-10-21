// Synthetic fixtures only. PGlite and MOCKED Auth, never the cloud project.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Passare il percorso esterno di @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const uuid = n => `90000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const roles = ['founder', 'production', 'logistics', 'finance', 'consultant', 'outsider', 'inactive'];
const users = Object.fromEntries(roles.map((name, index) => [name, uuid(index + 1)]));
const items = [uuid(101), uuid(102), uuid(103), uuid(104), uuid(105), uuid(106), uuid(107)];
const location = uuid(200);
const at = new Date(Date.now() - 60_000).toISOString();
const payload = (overrides = {}) => ({ schema_version: 1, channel: 'direct', occurred_at: at,
  location_id: location, lines: [{ stock_item_id: items[0], quantity: 1, unit_price_cents: 4001, discount_cents: 0 }],
  fulfillment_mode: 'delivered_now', payment: { status: 'unpaid' }, ...overrides });
const line = (item = items[0], quantity = 1, extra = {}) => ({ stock_item_id: item, quantity, unit_price_cents: 4001, discount_cents: 0, ...extra });
async function asUser(name, action, aal = 'aal1', role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users[name], aal, user_metadata: { role: 'founder' } })]);
    await db.exec(`set local role ${role}`);
    const result = await action();
    await db.exec('commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const sale = (input, operation = randomUUID(), name = 'logistics') => asUser(name, async () => (await db.query('select public.register_manual_sale($1, $2::jsonb) result', [operation, JSON.stringify(input)])).rows[0].result);
async function rejects(action, message, code) {
  let caught;
  try { await action(); } catch (error) { caught = error; }
  check(caught, `Reject ${message}`);
  if (message) equal(caught.message, message, `Machine error ${message}`);
  if (code) equal(caught.code, code, `SQLSTATE ${message}`);
}
const count = async table => (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
const balance = async item => (await db.query('select quantity::text n from public.stock_balances where stock_item_id=$1 and location_id=$2', [item, location])).rows[0].n;

try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;`);
  const directory = new URL('../migrations/', import.meta.url);
  // Domain suite: real Supabase Storage policies belong to their own harness.
  const domainMigrations = /_(initial_schema|finance_imports|sales_ecosystem|sales_lifecycle)\.sql$/;
  for (const name of readdirSync(directory).filter(name => domainMigrations.test(name)).sort()) await db.exec(readFileSync(new URL(name, directory), 'utf8'));
  for (const name of roles) {
    await db.query('insert into auth.users(id) values ($1)', [users[name]]);
    if (name === 'outsider') continue;
    await db.query('insert into public.profiles(user_id, display_name) values ($1,$2)', [users[name], name]);
    await db.query('insert into public.memberships(user_id,role,active,finance_access) values ($1,$2,$3,$4)', [users[name], name === 'inactive' ? 'finance' : name, name !== 'inactive', ['production', 'finance'].includes(name)]);
  }
  await db.query("insert into public.products(id,model,category) values ($1,'SYNTHETIC','T-shirt')", [uuid(300)]);
  await db.query("insert into public.stock_locations(id,code,name,location_type) values ($1,'TEST','Synthetic only','central')", [location]);
  for (let i = 0; i < items.length; i += 1) {
    await db.query("insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur,active) values ($1,'product',$2,'Synthetic only',$3,40.01,$4)", [items[i], `SYNTHETIC-${i}`, i === 1 ? null : '13.20', i !== 3]);
    await db.query("insert into public.product_variants(stock_item_id,product_id,color,size) values ($1,$2,'Test','M')", [items[i], uuid(300)]);
    if (i !== 2) await db.query("insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values ($1,$2,$3,'opening',10,'Synthetic initial count')", [randomUUID(), items[i], location]);
    else await db.query('insert into public.stock_balances(stock_item_id,location_id,quantity) values ($1,$2,null)', [items[i], location]);
  }

  await rejects(() => sale(payload()), 'sales_disabled', '42501');
  await db.exec("update public.app_settings set manual_sales_enabled=true, sales_started_at=now()-interval '1 day'");
  for (const name of ['outsider', 'inactive']) await rejects(() => sale(payload(), randomUUID(), name), 'membership_required', '42501');
  await rejects(() => asUser('outsider', () => db.query('select public.register_manual_sale($1,$2)', [randomUUID(), JSON.stringify(payload())]), 'aal1', 'anon'), null, '42501');

  const operation = randomUUID();
  const paid = payload({ lines: [line(items[0], 2)], payment: { status: 'paid', method: 'cash', amount_cents: 8002, occurred_at: at } });
  const registered = await sale(paid, operation);
  equal(registered.total_cents, 8002, 'Integer cents, never floating point');
  equal(registered.payment_state, 'paid', 'Declared payment state separate');
  equal(registered.fulfillment_state, 'fulfilled', 'Delivered now fulfilled');
  equal(registered.replayed, false, 'First execution');
  equal(registered.lines[0].on_hand_after, 8, 'Delivered sale physically removes two');
  equal(registered.lines[0].reserved_quantity, 0, 'Delivered sale has no pending reservation');
  equal(await balance(items[0]), '8', 'Actual balance changed');
  equal(await count('sales_orders'), 1, 'One order');
  equal(await count('sales_order_lines'), 1, 'One line');
  equal(await count('order_payments'), 1, 'One observed payment');
  equal(await count('commercial_facts'), 2, 'Sale and payment are separate observed fact kinds');
  equal(await count('finance_entries'), 0, 'No automatic approved accounting entry');
  equal(await count('finance_import_transactions'), 0, 'No manufactured BudgetFlow cash row');
  equal((await db.query('select unit_cost_cents::text n,list_price_cents::text p from public.sales_order_lines')).rows[0], { n: '1320', p: '4001' }, 'Server catalog snapshots');
  const movement = (await db.query("select operation_id,kind::text kind from public.stock_movements where kind::text='sale_fulfillment'")).rows[0];
  check(movement.operation_id !== operation, 'Effect has its own stable operation ID');
  const beforeRetry = await count('audit_logs');
  const replay = await sale(paid, operation);
  equal(replay, { ...registered, replayed: true }, 'Retry returns the original committed result');
  equal(await count('audit_logs'), beforeRetry, 'Retry has no additional side effects or audit');
  equal(await balance(items[0]), '8', 'Retry cannot double debit stock');
  await rejects(() => sale(payload(), operation), 'idempotency_conflict', '22023');
  await rejects(() => sale(paid, operation, 'consultant'), 'idempotency_conflict', '22023');
  await db.exec('update public.stock_items set list_price_eur=41.99 where sku=\'SYNTHETIC-0\'');
  equal((await sale(paid, operation)).total_cents, 8002, 'Replay does not reprice with a changed catalog');
  await db.exec('update public.stock_items set list_price_eur=40.01 where sku=\'SYNTHETIC-0\'');

  const beforeFailure = Object.fromEntries(await Promise.all(['sales_orders', 'sales_order_lines', 'order_payments', 'commercial_facts', 'stock_movements', 'audit_logs'].map(async table => [table, await count(table)])));
  await rejects(() => sale(payload({ lines: [line(items[0], 1), line(items[1], 11)] })), 'insufficient_ready_stock', '22023');
  for (const [table, n] of Object.entries(beforeFailure)) equal(await count(table), n, `Atomic rollback ${table}`);
  equal(await balance(items[0]), '8', 'No first-line partial stock debit');
  await rejects(() => sale(payload({ lines: [line(items[2])] })), 'unknown_stock', '22023');
  await rejects(() => sale(payload({ lines: [line(items[3])] })), 'inactive_item', '22023');
  const reservesBefore = await count('stock_reservations');
  await rejects(() => sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[0]), line(items[2])] })), 'unknown_stock', '22023');
  equal(await count('stock_reservations'), reservesBefore, 'A later unknown stock rolls back an earlier reservation');
  equal(await count('stock_reservation_events'), 0, 'Failed preparation leaves no reservation event');
  equal(await count('production_requirements'), 0, 'Failed preparation leaves no production work');
  equal((await db.query('select count(*)::int n from private.sales_outbox')).rows[0].n, 1, 'Failed commands do not enqueue effects');

  const pairPayload = payload({ lines: [line(items[0], 1), line(items[1], 1)], fulfillment_mode: 'prepare' });
  const pairOperation = randomUUID();
  const pairOrder = await sale(pairPayload, pairOperation);
  const reversed = { ...pairPayload, lines: [...pairPayload.lines].reverse(), reason: null, external_reference: '   ' };
  equal(await sale(reversed, pairOperation), { ...pairOrder, replayed: true }, 'Canonical hash ignores line ordering and absent/blank optional fields');

  const prepared = await sale(payload({ lines: [line(items[0], 10), line(items[1], 2)], fulfillment_mode: 'prepare' }));
  equal(prepared.fulfillment_state, 'unfulfilled', 'Preparation is not delivery');
  const first = prepared.lines.find(row => row.stock_item_id === items[0]);
  const second = prepared.lines.find(row => row.stock_item_id === items[1]);
  equal([first.reserved_quantity, first.production_required_quantity, first.on_hand_after, first.available_after], [7, 3, 8, 0], 'Reserve ready quantity, produce only deficit');
  equal([second.reserved_quantity, second.production_required_quantity, second.on_hand_after, second.available_after], [2, 0, 10, 7], 'Each SKU allocated independently');
  equal(await balance(items[0]), '8', 'Preparing does not remove physical stock');
  const nextPrepared = await sale(payload({ fulfillment_mode: 'prepare' }));
  equal(nextPrepared.lines[0].reserved_quantity, 0, 'Subsequent order cannot reserve already committed stock');
  equal(nextPrepared.lines[0].production_required_quantity, 1, 'Deficit goes to production planning');
  await rejects(() => sale(payload()), 'insufficient_ready_stock', '22023');
  await db.exec('update public.app_settings set stock_adjustments_enabled=true');
  await rejects(() => asUser('logistics', () => db.query('select public.adjust_stock($1,$2,$3,-1,\'Synthetic adjustment\')', [randomUUID(), items[0], location])), 'reserved_stock_conflict', '22023');
  equal(await balance(items[0]), '8', 'Existing adjustment API cannot invalidate reservations');
  equal((await db.query('select unit_cost_cents from public.sales_order_lines where stock_item_id=$1', [items[1]])).rows[0].unit_cost_cents, null, 'Unknown cost remains unknown');

  for (const bad of [
    null, [], 'not an object', {}, payload({ lines: null }), payload({ lines: {} }), payload({ lines: [] }),
    payload({ total_cents: 1 }), payload({ channel: 'shopify' }), payload({ channel: 'shopify_pos' }),
    payload({ schema_version: '1' }), payload({ lines: [line(items[1], 1.5)] }),
    payload({ lines: [line(items[1], 0)] }), payload({ lines: [line(items[1], -1)] }),
    payload({ lines: [line(items[1], 100001)] }), payload({ lines: [line(items[1], '1')] }),
    payload({ lines: [line(items[1], 1, { unit_price_cents: 1000000001 })] }),
    payload({ lines: [line(items[1], 1, { discount_cents: -1 })] }),
    payload({ lines: Array.from({ length: 51 }, (_, index) => line(uuid(1000 + index))) }),
    payload({ lines: [{ ...line(items[1]), stock_item_id: 'invalid uuid' }] }),
    payload({ lines: [line(items[1], 1, { unit_price_cents: 1.01 })] }),
    payload({ lines: [line(items[1], 1, { discount_cents: 4002 })] }),
    payload({ lines: [line(items[1]), line(items[1])] }),
    payload({ lines: [line(items[1], 1, { unit_cost_cents: 1 })] }),
    payload({ occurred_at: 'tomorrow' }), payload({ occurred_at: '2020-01-01T00:00:00Z' }),
    payload({ occurred_at: '2026-02-30T00:00:00Z' }), payload({ occurred_at: '2026-10-21T00:00:00' }),
    payload({ occurred_at: '2999-01-01T00:00:00Z' }),
    payload({ payment: { status: 'paid', method: 'cash', amount_cents: 1, occurred_at: at } }),
    payload({ payment: { status: 'unpaid', amount_cents: 1 } }),
    payload({ payment: { status: 'paid', method: 'shopify', amount_cents: 4001, occurred_at: at } }),
    payload({ payment: { status: 'paid', method: 'cash', amount_cents: 4001, occurred_at: at, provider_transaction_id: 'spoof' } }),
    payload({ channel: 'etsy', external_reference: '' }), payload({ location_id: uuid(999) }),
    payload({ external_reference: 123 }), payload({ reason: 123 }), payload({ reason: 'ab' }),
  ]) await rejects(() => sale(bad), 'invalid_payload', '22023');
  await rejects(() => sale(payload({ lines: [line(items[1], 1, { unit_price_cents: 3000 })], fulfillment_mode: 'prepare' })), 'price_change_reason_required', '22023');
  const discounted = await sale(payload({ lines: [line(items[1], 1, { discount_cents: 100 })], reason: 'Synthetic approved-by-policy discount', fulfillment_mode: 'prepare' }), randomUUID(), 'consultant');
  equal(discounted.total_cents, 3901, 'Every active member can apply a documented discount');
  const external = payload({ channel: 'etsy', external_reference: 'SYNTHETIC-ETSY-1', fulfillment_mode: 'prepare', lines: [line(items[1])] });
  await sale(external);
  await rejects(() => sale(external), 'duplicate_external_reference', '23505');
  equal((await db.query('select count(distinct operation_id)::int n from public.stock_movements')).rows[0].n, await count('stock_movements'), 'Every persisted physical effect has a distinct operation ID');
  for (const table of ['order_payments', 'stock_reservation_events', 'fulfillment_lines', 'commercial_facts']) {
    await rejects(() => db.exec(`delete from public.${table}`), 'Registro append-only: aggiungere un movimento di rettifica.', '42501');
  }
  const observations = (await db.query("select distinct review_status from public.commercial_facts")).rows;
  equal(observations, [{ review_status: 'observed_unclassified' }], 'Observed facts never claim classification or tax approval');
  await db.exec('update public.app_settings set manual_sales_enabled=false');
  equal((await sale(paid, operation)).replayed, true, 'Disabling new writes still permits an authorized exact retry');
  await rejects(() => sale(payload({ fulfillment_mode: 'prepare' })), 'sales_disabled', '42501');
  await db.exec('update public.app_settings set manual_sales_enabled=true');

  const exposed = ['sales_orders', 'sales_order_lines', 'order_payments', 'stock_reservations', 'stock_reservation_events', 'production_requirements', 'production_receipts', 'fulfillment_lines', 'commercial_facts'];
  for (const table of exposed) {
    equal((await db.query('select relrowsecurity enabled from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].enabled, true, `RLS on ${table}`);
    await rejects(() => asUser('logistics', () => db.exec(`delete from public.${table}`)), null, '42501');
    await rejects(() => asUser('outsider', () => db.exec(`select * from public.${table}`), 'aal1', 'anon'), null, '42501');
    equal(await asUser('outsider', async () => (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n), 0, `Outsider no rows from ${table}`);
  }
  equal(await asUser('outsider', async () => (await db.query('select count(*)::int n from public.operational_stock_availability')).rows[0].n), 0, 'Invoker stock view preserves source RLS');
  await rejects(() => asUser('consultant', () => db.exec('update public.app_settings set manual_sales_enabled=true')), null, '42501');
  await rejects(() => asUser('consultant', () => db.exec('select * from private.sales_outbox')), null, '42501');
  await rejects(() => asUser('consultant', () => db.exec('insert into public.finance_entries(entry_date,entry_type,amount_eur,description) values (current_date,\'income\',1,\'Spoof\')')), null, '42501');
  for (const name of ['founder', 'production', 'logistics', 'finance', 'consultant']) for (const aal of ['aal1', 'aal2']) {
    const financeAllowed = aal === 'aal2' && ['founder', 'production', 'finance'].includes(name);
    equal(await asUser(name, async () => (await db.query('select count(*)::int n from public.commercial_facts')).rows[0].n > 0, aal), financeAllowed, `${name}/${aal} Finance facts access`);
    equal(await asUser(name, async () => (await db.query('select count(*)::int n from public.order_payments')).rows[0].n > 0, aal), financeAllowed, `${name}/${aal} payment references access`);
    check(await asUser(name, async () => (await db.query('select count(*)::int n from public.sales_orders')).rows[0].n > 0, aal), `${name}/${aal} operational sales visible`);
  }
  const command = (name, input, operation = randomUUID(), user = 'consultant') => asUser(user, async () => (await db.query(`select public.${name}($1,$2::jsonb) result`, [operation, JSON.stringify(input)])).rows[0].result);
  const lifecycleOrder = await sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[4], 12)], payment: { status: 'paid', method: 'cash', amount_cents: 48012, occurred_at: at } }));
  const lifecycleLine = lifecycleOrder.lines[0].order_line_id;
  const requirement = (await db.query('select id from public.production_requirements where order_line_id=$1', [lifecycleLine])).rows[0].id;
  const production = { requirement_id: requirement, quantity: 1, occurred_at: at, reason: 'Synthetic physically counted production' };
  await rejects(() => command('complete_production', production), 'production_permission_required', '42501');
  const productionOp = randomUUID();
  const receipt = await command('complete_production', production, productionOp, 'production');
  equal(receipt.completed_quantity, 1, 'Production receipt records only observed ready units');
  equal(await balance(items[4]), '11', 'Production physically adds a ready unit');
  equal((await command('complete_production', production, productionOp, 'production')).replayed, true, 'Production retry idempotent');
  equal(await balance(items[4]), '11', 'Production retry cannot duplicate receipt');
  await rejects(() => command('complete_production', { ...production, quantity: 2 }, randomUUID(), 'founder'), 'production_quantity_exceeded', '22023');
  const fulfillInput = { order_id: lifecycleOrder.order_id, lines: [{ order_line_id: lifecycleLine, quantity: 5 }], occurred_at: at, reason: 'Synthetic actual dispatch' };
  const fulfillOp = randomUUID();
  const fulfillment = await command('fulfill_order_lines', fulfillInput, fulfillOp);
  equal(fulfillment.fulfillment_state, 'partial', 'Partial dispatch state');
  equal(await balance(items[4]), '6', 'Dispatch removes only the five delivered units');
  equal((await command('fulfill_order_lines', fulfillInput, fulfillOp)).replayed, true, 'Fulfillment retry idempotent');
  equal(await balance(items[4]), '6', 'Repeated dispatch does not double debit');
  await rejects(() => command('fulfill_order_lines', { ...fulfillInput, lines: [{ order_line_id: lifecycleLine, quantity: 7 }] }), 'insufficient_ready_stock', '22023');
  const cancelInput = { order_id: lifecycleOrder.order_id, lines: [{ order_line_id: lifecycleLine, quantity: 7 }], occurred_at: at, reason: 'Synthetic requested cancellation' };
  const cancelOp = randomUUID();
  const cancellation = await command('cancel_unfulfilled_lines', cancelInput, cancelOp);
  equal(cancellation.refund_due_cents, 28007, 'Paid cancellation exposes the amount requiring a separate refund');
  equal(cancellation.fulfillment_state, 'fulfilled', 'Remaining non-cancelled units were delivered');
  equal(cancellation.order_state, 'partially_cancelled', 'Cancellation state is independent of fulfillment');
  equal(await balance(items[4]), '6', 'Cancellation releases reservations without adding fictitious physical stock');
  equal((await db.query('select reserved_quantity::text n from public.stock_reservations where order_line_id=$1', [lifecycleLine])).rows[0].n, '0', 'Cancelled remainder releases all ready reservations');
  equal((await db.query('select completed_quantity,cancelled_quantity from public.production_requirements where id=$1', [requirement])).rows[0], { completed_quantity: 1, cancelled_quantity: 1 }, 'Cancellation closes unproduced deficit, keeps actual completed unit');
  equal((await command('cancel_unfulfilled_lines', cancelInput, cancelOp)).replayed, true, 'Cancellation retry idempotent');
  await rejects(() => command('cancel_unfulfilled_lines', { ...cancelInput, lines: [{ order_line_id: lifecycleLine, quantity: 1 }] }), 'unfulfilled_quantity_exceeded', '22023');
  await rejects(() => command('complete_production', production, randomUUID(), 'production'), 'production_quantity_exceeded', '22023');
  await rejects(() => command('cancel_unfulfilled_lines', cancelInput, fulfillOp), 'idempotency_conflict', '22023');

  const payOrder = await sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[5], 3)] }));
  const payLine = payOrder.lines[0].order_line_id;
  await command('cancel_unfulfilled_lines', { order_id: payOrder.order_id, lines: [{ order_line_id: payLine, quantity: 1 }], occurred_at: at, reason: 'Synthetic partial cancellation' });
  const paymentInput = { order_id: payOrder.order_id, amount_cents: 8002, method: 'cash', occurred_at: at, reference: 'Synthetic receipt' };
  await rejects(() => command('record_manual_payment', { ...paymentInput, amount_cents: 12003 }), 'payment_amount_mismatch', '22023');
  const paymentOp = randomUUID();
  const paidResult = await command('record_manual_payment', paymentInput, paymentOp);
  equal(paidResult.payment_state, 'paid', 'Separate payment settles the remaining amount after cancellation');
  equal(paidResult.refund_due_cents, 0, 'Payment creates no invented overpayment');
  equal(await balance(items[5]), '10', 'Payment never removes physical stock');
  equal((await command('record_manual_payment', paymentInput, paymentOp)).replayed, true, 'Payment retry idempotent');
  await rejects(() => command('record_manual_payment', paymentInput), 'payment_already_recorded', '22023');
  const finalCancellation = await command('cancel_unfulfilled_lines', { order_id: payOrder.order_id, lines: [{ order_line_id: payLine, quantity: 2 }], occurred_at: at, reason: 'Synthetic remaining cancellation' });
  equal(finalCancellation.order_state, 'cancelled', 'All units cancelled');
  equal(finalCancellation.refund_due_cents, 8002, 'Only actual declared payment becomes refund due');
  equal(await count('finance_entries'), 0, 'Lifecycle commands do not post approved accounting');
  for (const name of ['founder', 'production', 'finance']) {
    check((await sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[5])] }), randomUUID(), name)).order_id, `${name} can register sales`);
  }
  const discountedOrder = await sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[5], 3, { discount_cents: 1 })], reason: 'Synthetic one-cent total line discount' }));
  const discountedLine = discountedOrder.lines[0].order_line_id;
  for (const [index, expected] of [4000, 8001, 12002].entries()) {
    const result = await command('cancel_unfulfilled_lines', { order_id: discountedOrder.order_id, lines: [{ order_line_id: discountedLine, quantity: 1 }], occurred_at: at, reason: `Synthetic cancellation part ${index + 1}` });
    equal(result.cancelled_cents, expected, 'Cumulative cents allocation preserves every discount remainder');
    equal(result.refund_due_cents, 0, 'Cancelling an unpaid order creates no cash outflow');
  }
  await rejects(() => command('record_manual_payment', { ...paymentInput, order_id: discountedOrder.order_id, amount_cents: 0 }), 'order_cancelled', '22023');
  await rejects(() => sale(payload({ fulfillment_mode: 'prepare', lines: [line(items[5])] }), productionOp), 'idempotency_conflict', '22023');
  const wrongOrder = { ...fulfillInput, order_id: payOrder.order_id };
  await rejects(() => command('fulfill_order_lines', wrongOrder), 'invalid_payload', '22023');
  await rejects(() => command('cancel_unfulfilled_lines', wrongOrder), 'invalid_payload', '22023');
  const orderedLines = [...prepared.lines].sort((a, b) => a.order_line_id.localeCompare(b.order_line_id));
  const beforeBadDispatch = [await balance(items[0]), await balance(items[1])];
  const partialThenFail = { order_id: prepared.order_id, lines: [
    { order_line_id: orderedLines[0].order_line_id, quantity: 1 }, { order_line_id: orderedLines[1].order_line_id, quantity: 100 },
  ], occurred_at: at, reason: 'Synthetic multi-line rollback check' };
  await rejects(() => command('fulfill_order_lines', partialThenFail), 'unfulfilled_quantity_exceeded', '22023');
  equal([await balance(items[0]), await balance(items[1])], beforeBadDispatch, 'Multi-line fulfillment error cannot partially remove stock');
  const reservedBeforeBadCancel = (await db.query('select order_line_id,reserved_quantity::text n from public.stock_reservations order by order_line_id')).rows;
  await rejects(() => command('cancel_unfulfilled_lines', partialThenFail), 'unfulfilled_quantity_exceeded', '22023');
  equal((await db.query('select order_line_id,reserved_quantity::text n from public.stock_reservations order by order_line_id')).rows, reservedBeforeBadCancel, 'Multi-line cancellation error cannot partially release reservations');
  await asUser('logistics', () => db.query('select public.adjust_stock($1,$2,$3,-9,\'Synthetic last-unit setup\')', [randomUUID(), items[6], location]));
  // Sequential last-unit check only: PGlite is NOT a multi-connection race test.
  await sale(payload({ lines: [line(items[6])] }));
  equal(await balance(items[6]), '0', 'The last physical unit can be delivered once');
  await rejects(() => sale(payload({ lines: [line(items[6])] })), 'insufficient_ready_stock', '22023');
  const zeroStockPreparation = await sale(payload({ lines: [line(items[6])], fulfillment_mode: 'prepare' }));
  equal(zeroStockPreparation.lines[0].production_required_quantity, 1, 'Known zero opens production; unknown stock was rejected');
  const orderCountBeforeBadLifecycle = await count('audit_logs');
  for (const [name, good] of [['fulfill_order_lines', fulfillInput], ['cancel_unfulfilled_lines', cancelInput], ['record_manual_payment', paymentInput], ['complete_production', production]]) {
    for (const user of ['outsider', 'inactive']) await rejects(() => command(name, good, randomUUID(), user), 'membership_required', '42501');
    await rejects(() => asUser('outsider', () => db.query(`select public.${name}($1,$2::jsonb)`, [randomUUID(), JSON.stringify(good)]), 'aal1', 'anon'), null, '42501');
    await rejects(() => command(name, { ...good, provider_transaction_id: 'spoof' }, randomUUID(), name === 'complete_production' ? 'production' : 'consultant'), 'invalid_payload', '22023');
  }
  equal(await count('audit_logs'), orderCountBeforeBadLifecycle, 'Rejected lifecycle commands leave no audit or state side effects');
  await rejects(() => asUser('consultant', () => db.exec('select * from private.sales_command_receipts')), null, '42501');
  await rejects(() => db.exec('delete from public.production_receipts'), 'Registro append-only: aggiungere un movimento di rettifica.', '42501');
  await db.exec('update public.app_settings set manual_sales_enabled=false');
  equal((await command('complete_production', production, productionOp, 'production')).replayed, true, 'Production result can be retried when new commands disabled');
  equal((await command('record_manual_payment', paymentInput, paymentOp)).replayed, true, 'Payment result can be retried when new commands disabled');
  await rejects(() => command('fulfill_order_lines', fulfillInput), 'sales_disabled', '42501');
  await db.exec('update public.app_settings set manual_sales_enabled=true');
  await db.exec('update public.memberships set active=false where user_id=\'' + users.logistics + '\'');
  await rejects(() => sale(payload({ fulfillment_mode: 'prepare' })), 'membership_required', '42501');
  equal(await asUser('logistics', async () => (await db.query('select count(*)::int n from public.sales_orders')).rows[0].n), 0, 'Revoked membership effective immediately');
  equal(await count('finance_entries'), 0, 'All commands leave approved Finance entries untouched');
  equal(await count('finance_import_transactions'), 0, 'Historical cash imports remain separate');
  console.log(`PASS ${checks} sales ecosystem checks; synthetic fixtures, embedded Postgres and mocked Auth. Real JWT/PostgREST, multiple concurrent connections and cloud activation remain unverified.`);
} finally { await db.close(); }
