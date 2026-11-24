import { createServer } from "node:http";
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
    if (!(await stat(target)).isFile()) throw new Error("not_found");
    response.setHeader("Content-Type", types[extname(target)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
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
