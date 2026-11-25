const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  API_VERSION,
  EXPECTED_APP_TITLE,
  QUERIES,
  main,
  runPermissionProbe,
} from "./probe-shopify-permissions.mjs";

const ENV = {
  SHOPIFY_SHOP_DOMAIN: "synthetic-shop.myshopify.com",
  SHOPIFY_CLIENT_ID: "synthetic_client_123",
  SHOPIFY_CLIENT_SECRET: "synthetic_secret_never_log_123",
  SHOPIFY_PROBE_ORDER_GID: "gid://shopify/Order/123456",
};
const TOKEN = "synthetic_admin_token_never_log_123";
const auth = () =>
  new Response(
    JSON.stringify({ access_token: TOKEN, expires_in: 86400, scope: "read_products,read_orders" }),
  );
const json = (body, version = API_VERSION) =>
  new Response(JSON.stringify(body), { headers: { "x-shopify-api-version": version } });
const identity = (title = EXPECTED_APP_TITLE) =>
  json({
    data: {
      currentAppInstallation: {
        app: { title },
        accessScopes: [{ handle: "read_orders" }, { handle: "read_products" }],
      },
    },
  });
function transport(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request with " + ENV.SHOPIFY_CLIENT_SECRET);
    return response;
  };
  return { calls, fetchImpl };
}
function assertRedacted(value) {
  const text = JSON.stringify(value);
  for (const secret of [
    TOKEN,
    ENV.SHOPIFY_CLIENT_SECRET,
    ENV.SHOPIFY_CLIENT_ID,
    ENV.SHOPIFY_PROBE_ORDER_GID,
  ])
    assert.ok(!text.includes(secret), "Sensitive input in report");
}

test("CLI help precedes environment validation; import has no network side effects", () => {
  const help = spawnSync(process.execPath, ["scripts/probe-shopify-permissions.mjs", "--help"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Uso:/);
  assert.doesNotMatch(help.stdout, /INVALID_SHOP_DOMAIN/);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "globalThis.fetch=()=>{throw new Error('NETWORK CALLED')}; await import('./scripts/probe-shopify-permissions.mjs');",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("default dry-run never reads credentials or invokes fetch", async () => {
  const report = await runPermissionProbe({
    env: ENV,
    fetchImpl: () => {
      throw new Error("network called");
    },
  });
  assert.equal(report.networkRequests, 0);
  assert.equal(report.mode, "dry-run");
  assertRedacted(report);
});

test("invalid destination or order fails before any request", async () => {
  for (const env of [
    { ...ENV, SHOPIFY_SHOP_DOMAIN: "synthetic-shop.myshopify.com.evil.test" },
    { ...ENV, SHOPIFY_PROBE_ORDER_GID: "gid://shopify/Customer/123456" },
  ]) {
    let calls = 0;
    await assert.rejects(
      runPermissionProbe({
        env,
        run: true,
        fetchImpl: () => {
          calls++;
        },
      }),
      /INVALID_/,
    );
    assert.equal(calls, 0);
  }
});

test("metadata-only run checks exact app and granted scopes without order calls", async () => {
  const io = transport([auth(), identity()]);
  const report = await runPermissionProbe({
    env: { ...ENV, SHOPIFY_PROBE_ORDER_GID: "" },
    run: true,
    fetchImpl: io.fetchImpl,
  });
  assert.equal(io.calls.length, 2);
  assert.equal(report.identityVerified, true);
  assert.equal(report.scopePresence.read_locations, false);
  assertRedacted(report);
  assert.equal(new URLSearchParams(io.calls[0].init.body).get("grant_type"), "client_credentials");
  assert.equal(io.calls[1].init.headers["X-Shopify-Access-Token"], TOKEN);
  for (const call of io.calls) {
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
  }
});

test("different app is blocked before order probes and its title is not echoed", async () => {
  const io = transport([auth(), identity("Synthetic Other Connector")]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(io.calls.length, 2);
  assert.equal(report.identityVerified, false);
  assert.equal(report.reports.at(-1).status, "APP_IDENTITY_MISMATCH");
  assert.doesNotMatch(JSON.stringify(report), /Synthetic Other Connector/);
});

test("isolated probes identify denied location while redacting messages, unknown codes and path IDs", async () => {
  const io = transport([
    auth(),
    identity(),
    json({ data: { order: { id: ENV.SHOPIFY_PROBE_ORDER_GID } } }),
    json({
      errors: [
        {
          message: ENV.SHOPIFY_CLIENT_SECRET,
          extensions: { code: "ACCESS_DENIED" },
          path: ["order", "retailLocation", ENV.SHOPIFY_PROBE_ORDER_GID],
        },
        { extensions: { code: TOKEN }, path: [TOKEN] },
      ],
    }),
    json({
      data: {
        order: {
          id: ENV.SHOPIFY_PROBE_ORDER_GID,
          fulfillments: [{ location: { id: "gid://shopify/Location/999" } }],
        },
      },
    }),
  ]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(io.calls.length, 5);
  assert.equal(report.reports[3].status, "GRAPHQL_ERROR");
  assert.deepEqual(report.reports[3].errors[0], {
    code: "ACCESS_DENIED",
    path: ["order", "retailLocation", "[redacted]"],
  });
  assert.equal(report.reports[3].errors[1].code, "UNKNOWN_CODE");
  assert.equal(report.reports[4].branch, "present");
  assertRedacted(report);
  assert.doesNotMatch(JSON.stringify(report), /Location\/999/);
  for (const call of io.calls.slice(1)) {
    const payload = JSON.parse(call.init.body);
    assert.match(payload.query, /^query /);
    assert.ok(Object.values(QUERIES).includes(payload.query));
    assert.doesNotMatch(payload.query, /mutation|apply_shopify|worker/);
  }
});

test("empty optional branches are explicit and never reported as populated locations", async () => {
  const io = transport([
    auth(),
    identity(),
    json({ data: { order: { id: ENV.SHOPIFY_PROBE_ORDER_GID } } }),
    json({ data: { order: { id: ENV.SHOPIFY_PROBE_ORDER_GID, retailLocation: null } } }),
    json({ data: { order: { id: ENV.SHOPIFY_PROBE_ORDER_GID, fulfillments: [] } } }),
  ]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(report.reports[3].branch, "empty");
  assert.equal(report.reports[4].branch, "empty");
});

test("401 is not retried, and arbitrary response body is not printed", async () => {
  const io = transport([new Response(ENV.SHOPIFY_CLIENT_SECRET, { status: 401 })]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(io.calls.length, 1);
  assert.equal(report.reports[0].http, 401);
  assert.equal(report.reports[0].status, "HTTP_ERROR");
  assertRedacted(report);
});

test("API version mismatch and invisible order stop further probes", async () => {
  for (const responses of [
    [auth(), json({}, "2026-07")],
    [auth(), identity(), json({ data: { order: null } })],
  ]) {
    const expected = responses.length;
    const io = transport(responses);
    const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
    assert.equal(io.calls.length, expected);
    assert.notEqual(report.reports.at(-1).status, "ok");
    assertRedacted(report);
  }
});

test("bounded responses reject oversized JSON without returning its contents", async () => {
  const io = transport([new Response("x".repeat(65537))]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(report.reports[0].status, "RESPONSE_TOO_LARGE");
});

test("network exceptions are sanitised and no retries are attempted", async () => {
  let calls = 0;
  const report = await runPermissionProbe({
    env: ENV,
    run: true,
    fetchImpl: async () => {
      calls++;
      throw new Error(TOKEN + ENV.SHOPIFY_CLIENT_SECRET);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.reports[0].status, "NETWORK_ERROR");
  assertRedacted(report);
});

test("CLI returns useful status without printing input values", async () => {
  let output = "";
  let error = "";
  const code = await main(
    ["--run"],
    {},
    {
      stdout: (s) => {
        output += s;
      },
      stderr: (s) => {
        error += s;
      },
      fetchImpl: () => {
        throw new Error("network called");
      },
    },
  );
  assert.equal(code, 2);
  assert.equal(output, "");
  assert.equal(error, "INVALID_SHOP_DOMAIN\n");
});

test("timeout is bounded and reports no underlying exception text", async () => {
  const report = await runPermissionProbe({
    env: ENV,
    run: true,
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error(TOKEN)), { once: true }),
      ),
  });
  assert.equal(report.networkRequests, 1);
  assert.equal(report.reports[0].status, "TIMEOUT");
  assertRedacted(report);
});

test("malformed GraphQL errors fail closed even when data is present", async () => {
  const io = transport([
    auth(),
    identity(),
    json({ errors: { message: TOKEN }, data: { order: { id: ENV.SHOPIFY_PROBE_ORDER_GID } } }),
  ]);
  const report = await runPermissionProbe({ env: ENV, run: true, fetchImpl: io.fetchImpl });
  assert.equal(io.calls.length, 3);
  assert.equal(report.reports.at(-1).status, "INVALID_RESPONSE");
  assertRedacted(report);
});
