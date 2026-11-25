import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const API_VERSION = "2026-10";
export const EXPECTED_APP_TITLE = "LuckyLap Gestionale";
const MAX_BYTES = 64 * 1024;
const SCOPE_NAMES = [
  "read_products",
  "read_orders",
  "read_locations",
  "read_inventory",
  "read_markets_home",
  "read_all_orders",
];
const ERROR_CODES = new Set([
  "ACCESS_DENIED",
  "THROTTLED",
  "INTERNAL_ERROR",
  "INTERNAL_SERVER_ERROR",
  "MAX_COST_EXCEEDED",
  "SHOP_INACTIVE",
  "GRAPHQL_VALIDATION_FAILED",
]);
const PATH_FIELDS = new Set([
  "currentAppInstallation",
  "app",
  "title",
  "accessScopes",
  "handle",
  "order",
  "id",
  "retailLocation",
  "fulfillments",
  "location",
]);
export const QUERIES = Object.freeze({
  identity:
    "query ProbeAppIdentity { currentAppInstallation { app { title } accessScopes { handle } } }",
  order: "query ProbeOrderIdentity($id: ID!) { order(id: $id) { id } }",
  retailLocation:
    "query ProbeRetailLocation($id: ID!) { order(id: $id) { id retailLocation { id } } }",
  fulfillmentLocation:
    "query ProbeFulfillmentLocation($id: ID!) { order(id: $id) { id fulfillments(first: 1) { location { id } } } }",
});
const FIELDS = {
  identity: "currentAppInstallation.accessScopes",
  order: "order.id",
  retailLocation: "order.retailLocation.id",
  fulfillmentLocation: "order.fulfillments.location.id",
};

class InputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function validateEnvironment(env) {
  const shop = env.SHOPIFY_SHOP_DOMAIN ?? "";
  const clientId = env.SHOPIFY_CLIENT_ID ?? "";
  const clientSecret = env.SHOPIFY_CLIENT_SECRET ?? "";
  const orderId = env.SHOPIFY_PROBE_ORDER_GID || null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop))
    throw new InputError("INVALID_SHOP_DOMAIN");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) throw new InputError("INVALID_CLIENT_ID");
  if (!/^[\x21-\x7e]{20,512}$/.test(clientSecret)) throw new InputError("INVALID_CLIENT_SECRET");
  if (orderId !== null && !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,19}$/.test(orderId))
    throw new InputError("INVALID_ORDER_GID");
  return { shop, clientId, clientSecret, orderId };
}

export function redactErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 16).map((error) => ({
    code: ERROR_CODES.has(error?.extensions?.code) ? error.extensions.code : "UNKNOWN_CODE",
    path: Array.isArray(error?.path)
      ? error.path
          .slice(0, 12)
          .map((part) =>
            PATH_FIELDS.has(part)
              ? part
              : Number.isInteger(part) && part >= 0 && part <= 1000
                ? part
                : "[redacted]",
          )
      : [],
  }));
}

async function requestJson(fetchImpl, url, init, timeoutMs, graphql = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let http = null;
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    http = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { http, failure: "HTTP_ERROR" };
    }
    if (graphql && response.headers.get("x-shopify-api-version") !== API_VERSION) {
      await response.body?.cancel().catch(() => {});
      return { http, failure: "API_VERSION_MISMATCH" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { http, failure: "INVALID_RESPONSE" };
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          return { http, failure: "RESPONSE_TOO_LARGE" };
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return { http, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { http, failure: "INVALID_RESPONSE" };
    }
  } catch {
    return { http, failure: controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runPermissionProbe({
  env = {},
  fetchImpl = globalThis.fetch,
  run = false,
  timeoutMs = 8000,
} = {}) {
  const report = {
    mode: run ? "read-only" : "dry-run",
    apiVersion: API_VERSION,
    orderProvided: Boolean(env.SHOPIFY_PROBE_ORDER_GID),
    identityVerified: false,
    networkRequests: 0,
    reports: [],
  };
  if (!run) {
    report.plannedProbes = [
      "token",
      "identity",
      ...(report.orderProvided ? ["order", "retailLocation", "fulfillmentLocation"] : []),
    ];
    return report;
  }
  const config = validateEnvironment(env);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new InputError("INVALID_TIMEOUT");
  const request = async (...args) => {
    report.networkRequests++;
    return requestJson(fetchImpl, ...args, timeoutMs);
  };
  const auth = await request(`https://${config.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (auth.failure) {
    report.reports.push({
      probe: "token",
      field: "oauth.access_token",
      http: auth.http,
      status: auth.failure,
      errors: [],
    });
    return report;
  }
  const token = auth.body?.access_token;
  if (
    typeof token !== "string" ||
    !/^[\x21-\x7e]{20,512}$/.test(token) ||
    !Number.isInteger(auth.body?.expires_in) ||
    auth.body.expires_in < 1 ||
    auth.body.expires_in > 86400 ||
    typeof auth.body?.scope !== "string" ||
    auth.body.scope.length > 8192
  ) {
    report.reports.push({
      probe: "token",
      field: "oauth.access_token",
      http: auth.http,
      status: "INVALID_TOKEN_RESPONSE",
      errors: [],
    });
    return report;
  }
  report.reports.push({
    probe: "token",
    field: "oauth.access_token",
    http: auth.http,
    status: "ok",
    errors: [],
  });
  async function graphql(name) {
    report.networkRequests++;
    const result = await requestJson(
      fetchImpl,
      `https://${config.shop}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: QUERIES[name],
          variables: name === "identity" ? {} : { id: config.orderId },
        }),
      },
      timeoutMs,
      true,
    );
    const errors = redactErrors(result.body?.errors);
    const invalidErrors = result.body?.errors !== undefined && !Array.isArray(result.body.errors);
    const row = {
      probe: name,
      field: FIELDS[name],
      http: result.http,
      status:
        result.failure ??
        (invalidErrors ? "INVALID_RESPONSE" : errors.length ? "GRAPHQL_ERROR" : "ok"),
      errors,
    };
    report.reports.push(row);
    return { ...result, row };
  }
  const identity = await graphql("identity");
  if (identity.row.status !== "ok") return report;
  const installation = identity.body?.data?.currentAppInstallation;
  if (installation?.app?.title !== EXPECTED_APP_TITLE) {
    identity.row.status = "APP_IDENTITY_MISMATCH";
    return report;
  }
  if (
    !Array.isArray(installation.accessScopes) ||
    !installation.accessScopes.every(
      (scope) =>
        typeof scope?.handle === "string" && /^(read|write)_[a-z0-9_.]+$/.test(scope.handle),
    )
  ) {
    identity.row.status = "INVALID_RESPONSE";
    return report;
  }
  report.identityVerified = true;
  report.scopePresence = Object.fromEntries(
    SCOPE_NAMES.map((name) => [
      name,
      installation.accessScopes.some((scope) => scope.handle === name),
    ]),
  );
  if (!report.scopePresence.read_orders || !report.scopePresence.read_products) {
    identity.row.status = "REQUIRED_SCOPES_MISSING";
    return report;
  }
  if (!config.orderId) return report;
  const basic = await graphql("order");
  if (basic.row.status !== "ok") return report;
  if (basic.body?.data?.order?.id !== config.orderId) {
    basic.row.status = "ORDER_NOT_VISIBLE";
    return report;
  }
  for (const name of ["retailLocation", "fulfillmentLocation"]) {
    const result = await graphql(name);
    if (result.row.status !== "ok") continue;
    const order = result.body?.data?.order;
    if (order?.id !== config.orderId) {
      result.row.status = "INVALID_RESPONSE";
      continue;
    }
    if (name === "retailLocation")
      result.row.branch =
        order.retailLocation === null
          ? "empty"
          : typeof order.retailLocation?.id === "string"
            ? "present"
            : "invalid";
    else
      result.row.branch = Array.isArray(order.fulfillments)
        ? order.fulfillments.length
          ? order.fulfillments.some((f) => typeof f.location?.id === "string")
            ? "present"
            : "empty"
          : "empty"
        : "invalid";
    if (result.row.branch === "invalid") result.row.status = "INVALID_RESPONSE";
  }
  return report;
}

export const HELP = `Sonda permessi Shopify del gestionale — API ${API_VERSION}

Uso:
  node scripts/probe-shopify-permissions.mjs --help
  node scripts/probe-shopify-permissions.mjs --dry-run
  node scripts/probe-shopify-permissions.mjs --run

Senza --run non esegue rete. --help e --dry-run non richiedono credenziali.
Per --run: SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET.
Facoltativo: SHOPIFY_PROBE_ORDER_GID (solo gid://shopify/Order/... esplicito).
Usare la STESSA app interna LuckyLap Gestionale; un'altra identità viene bloccata.
OAuth usa POST per il token temporaneo; le chiamate Admin contengono solo query.
Nessuna mutation, scrittura database, worker, retry o modifica di impostazioni.
Output JSON su stdout, senza token, secret, ID o contenuti reali degli ordini.
Nessun file viene creato. Un ramo vuoto non prova la lettura di una location presente.
Codici uscita: 0 piano/probe riuscito; 1 accesso o risposta da verificare; 2 input.
`;

export async function main(argv = [], env = process.env, io = {}) {
  const out = io.stdout ?? ((text) => process.stdout.write(text));
  const err = io.stderr ?? ((text) => process.stderr.write(text));
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return 0;
  }
  if (
    argv.some((arg) => !["--run", "--dry-run"].includes(arg)) ||
    (argv.includes("--run") && argv.includes("--dry-run"))
  ) {
    err("INVALID_ARGUMENTS\n");
    return 2;
  }
  try {
    const report = await runPermissionProbe({
      env,
      run: argv.includes("--run"),
      ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
    });
    out(JSON.stringify(report, null, 2) + "\n");
    return report.reports.some((row) => row.status !== "ok") ? 1 : 0;
  } catch (error) {
    err((error instanceof InputError ? error.code : "PROBE_FAILED") + "\n");
    return error instanceof InputError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("PROBE_FAILED\n");
      process.exitCode = 1;
    },
  );
}
