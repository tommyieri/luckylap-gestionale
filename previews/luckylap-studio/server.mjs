import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { products } from "./catalog.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.LUCKYLAP_STUDIO_PORT || 4177);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
};
// Associazioni limitate a foto ufficiali verificate visivamente il 24/11/2026.
// Il catalogo pubblico non assegna queste immagini alle varianti colore.
const verifiedColorImages = {
  "964-tshirt": { White: "3.png", "Blue navy": "2.png" },
  "gt3rs-tshirt": { White: "Progetto_senza_titolo.png", "Blue navy": "4.png" },
};
function verifiedVariantImage(data, handle, variant) {
  if (variant.featured_image?.src) return variant.featured_image.src;
  const index = data.options.findIndex((option) =>
    /colou?r|colore/i.test(typeof option === "string" ? option : option.name),
  );
  const filename = verifiedColorImages[handle]?.[variant.options[index]];
  return filename
    ? data.images.find(
        (src) => new URL(src, "https://luckylap.com").pathname.split("/").pop() === filename,
      ) || null
    : null;
}
let cachedCatalog;
let fetchedAt = 0;
let pendingCatalog;

async function publicCatalog() {
  if (cachedCatalog && Date.now() - fetchedAt < 180_000) return cachedCatalog;
  if (pendingCatalog) return pendingCatalog;
  pendingCatalog = Promise.all(
    products.map(async (item) => {
      const handle = new URL(item.url).pathname.split("/").pop();
      try {
        const response = await fetch(`https://luckylap.com/it/products/${handle}.js`, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("catalog_unavailable");
        const data = await response.json();
        return {
          handle,
          price: data.price,
          available: data.available,
          options: data.options,
          variants: data.variants.map((variant) => {
            const { id, title, options, price, available } = variant;
            return {
              id,
              title,
              options,
              price,
              available,
              image: verifiedVariantImage(data, handle, variant),
            };
          }),
          images: data.images,
          currency: "EUR",
        };
      } catch {
        return { handle, error: "catalog_unavailable" };
      }
    }),
  )
    .then((items) => {
      cachedCatalog = items;
      fetchedAt = Date.now();
      return items;
    })
    .finally(() => {
      pendingCatalog = undefined;
    });
  return pendingCatalog;
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  if (pathname === "/api/shipping-policy") {
    response.setHeader("Content-Type", types[".json"]);
    response.setHeader("Cache-Control", "no-store");
    try {
      const configured = process.env.LUCKYLAP_SHIPPING_POLICY_PATH;
      if (!configured) throw new Error("not_configured");
      const source = JSON.parse(await readFile(configured, "utf8"));
      const { version, currency, rates, freeShipping } = source;
      if (
        currency !== "EUR" ||
        ![rates?.italy, rates?.europe, rates?.world, freeShipping?.minimumSubtotal].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        !Array.isArray(freeShipping.zones) ||
        !freeShipping.zones.every((zone) => ["italy", "europe", "world"].includes(zone))
      )
        throw new Error("invalid_policy");
      response.end(JSON.stringify({ version, currency, rates, freeShipping }));
    } catch {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "policy_unavailable" }));
    }
    return;
  }
  if (pathname === "/api/catalog") {
    response.setHeader("Content-Type", types[".json"]);
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(await publicCatalog()));
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  let target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (pathname === "/" || /^\/(products|collections|pages)\//.test(pathname))
    target = resolve(root, "index.html");
  try {
    const file = await stat(target);
    if (!file.isFile()) throw new Error("not_found");
    response.setHeader("Content-Type", types[extname(target)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
    if (extname(target) === ".mp4") {
      response.setHeader("Accept-Ranges", "bytes");
      let start = 0;
      let end = file.size - 1;
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (
          !match ||
          (!match[1] && !match[2]) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          start >= file.size
        ) {
          response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
          response.end();
          return;
        }
        response.statusCode = 206;
        response.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
      }
      response.setHeader("Content-Length", end - start + 1);
      if (request.method === "HEAD") response.end();
      else {
        const stream = createReadStream(target, { start, end });
        stream.on("error", () => response.destroy());
        response.on("close", () => stream.destroy());
        stream.pipe(response);
      }
      return;
    }
    response.end(request.method === "HEAD" ? undefined : await readFile(target));
  } catch {
    response.writeHead(404);
    response.end("Pagina non trovata");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`LuckyLap Studio: http://127.0.0.1:${port}`);
  void publicCatalog();
});
