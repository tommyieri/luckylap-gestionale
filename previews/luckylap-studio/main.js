import { products as sourceProducts } from "./catalog.js";

const main = document.querySelector("#main");
const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const icon = (id) => `<svg aria-hidden="true"><use href="/icons.svg#${id}"></use></svg>`;
const assets = (path) => `/${path}`;
const products = sourceProducts.map((product) => ({
  ...product,
  handle: new URL(product.url).pathname.split("/").pop(),
  image: assets(product.image),
  detailImage: assets(product.detailImage),
  thumb: assets(product.thumb),
}));
let liveCatalog = new Map();
let catalogState = "loading";
let selectedHero = "964-tee";
let currentCategory = "tshirts";
let selectedOptions = [];
let selectedProduct;
let imageIndex = 0;
let cart = [];
let toastTimer;
let returnFocus;
try {
  cart = JSON.parse(sessionStorage.getItem("luckylap-studio-bag") || "[]")
    .filter(
      (line) =>
        Number.isSafeInteger(line.variantId) &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0 &&
        products.some((p) => p.id === line.productId),
    )
    .map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: Math.min(line.quantity, 10),
    }));
} catch {
  cart = [];
}

const getLive = (product) => liveCatalog.get(product.handle);
const priceOf = (product) => {
  const data = getLive(product);
  return Number.isFinite(data?.price)
    ? money.format(data.price / 100)
    : catalogState === "loading"
      ? "Caricamento…"
      : "Vedi nello shop";
};
const findVariant = (product, options = selectedOptions) =>
  getLive(product)?.variants?.find((variant) =>
    variant.options.every((value, i) => value === options[i]),
  );
const fullImageUrl = (url) => (url?.startsWith("//") ? `https:${url}` : url);
const productUrl = (product) => `/products/${product.handle}`;
const productName = (product) =>
  `${product.name} ${product.category === "tshirts" ? "T-shirt" : "Cap"}`;

function card(product) {
  const alt = escapeHtml(product.alt);
  return `<article class="product-card"><a class="product-media" href="${productUrl(product)}" aria-label="Scopri ${escapeHtml(productName(product))}"><img src="${product.image}" alt="${alt}" width="960" height="960" loading="lazy" /><img class="product-secondary" src="${product.detailImage}" alt="" width="${product.detailWidth}" height="${product.detailHeight}" loading="lazy" /></a><div class="product-info"><h3 class="product-title"><a href="${productUrl(product)}">${escapeHtml(productName(product))}</a></h3><span class="product-price" data-price="${product.id}">${priceOf(product)}</span><p class="product-description">${product.category === "tshirts" ? "Cotone biologico · Regular unisex" : "Cotone lavato · Regolabile"}</p><a class="product-open" href="${productUrl(product)}" aria-label="Scegli ${escapeHtml(productName(product))}">${icon("arrow")}</a></div></article>`;
}

function heroPicker() {
  const product = products.find((p) => p.id === selectedHero);
  return `<a class="featured-picker-image" href="${productUrl(product)}"><img src="${product.image}" alt="${escapeHtml(product.alt)}" width="960" height="960" /></a><div class="featured-picker-info"><div class="featured-picker-tabs" role="group" aria-label="Esplora i modelli in evidenza">${[
    "964-tee",
    "f40-tee",
    "gt3rs-tee",
  ]
    .map((id) => {
      const item = products.find((p) => p.id === id);
      return `<button data-hero-product="${id}" aria-pressed="${id === selectedHero}">${escapeHtml(item.name)}</button>`;
    })
    .join(
      "",
    )}</div><span class="featured-picker-title">${escapeHtml(product.name)} · ${escapeHtml(product.colorLabel)}<span class="price-inline" data-price="${product.id}">${priceOf(product)}</span></span><a class="text-link" href="${productUrl(product)}">Scegli la taglia ${icon("right")}</a></div>`;
}

function home() {
  return `<section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><h1 class="hero-title" id="hero-title">La passione<br />si riconosce.</h1><p>T-shirt e cappellini per chi ama le auto.<br />Silhouette originali. Ricami a macchina realizzati in Italia sulle nostre T-shirt.</p><div class="hero-actions"><a class="btn btn-light" href="#collezione">Trova il tuo modello ${icon("arrow")}</a></div><div class="featured-picker" aria-label="Il tuo primo giro nella collezione">${heroPicker()}</div></div><div class="hero-media"><img src="/media/world-lifestyle.webp" alt="T-shirt GT3 RS LuckyLap navy indossata, con la silhouette ricamata sul petto" width="1066" height="1600" fetchpriority="high" /><a class="hero-photo-link" href="/products/gt3rs-tshirt">GT3 RS · Da indossare ogni giorno ${icon("arrow")}</a></div></section>
  <section class="collection-section" id="collezione" aria-labelledby="collection-title"><div class="section-heading"><h2 id="collection-title">Quale auto<br />ti rappresenta?</h2><p>Un’icona che riconosci al primo sguardo.<br />Un dettaglio che porti nel quotidiano.</p></div><div class="filter-tabs" role="group" aria-label="Scegli una categoria"><button data-home-filter="tshirts" aria-pressed="${currentCategory === "tshirts"}">T-shirt</button><button data-home-filter="caps" aria-pressed="${currentCategory === "caps"}">Cappellini</button></div><div class="shop-grid" id="home-products">${products
    .filter((p) => p.category === currentCategory)
    .map(card)
    .join("")}</div></section>
  <section class="story-grid" id="ricamo" aria-labelledby="embroidery-title"><div class="story-image"><img id="embroidery-image" src="/media/gt3rs-tee-detail.webp" alt="Dettaglio della GT3 RS ricamata sul cotone navy con cartellino LuckyLap" width="1200" height="800" loading="lazy" /></div><div class="story-copy"><h2 id="embroidery-title">Il disegno<br />diventa filo.</h2><p>Disegniamo le silhouette che ci fanno girare la testa. Poi le facciamo ricamare a macchina in Italia, sul cotone biologico delle nostre T-shirt.</p><p class="story-fact">Il carattere dell’auto, nelle sue linee.<br />Il tuo stile, nel modo di indossarle.</p><div class="story-detail-toggle" role="group" aria-label="Guarda i dettagli del ricamo"><button data-embroidery="gt3" aria-pressed="true">GT3 RS</button><button data-embroidery="project" aria-pressed="false">Project ’88</button></div><a class="text-link" href="/collections/t-shirt">Esplora le T-shirt ${icon("arrow")}</a></div></section>
  <section class="knitwear" id="maglieria" aria-labelledby="knitwear-title"><h2 id="knitwear-title">Il prossimo<br />capitolo si<br />fa in lana.</h2><div class="knitwear-copy"><div class="coming-soon">Maglieria in arrivo</div><p class="wool-truth">100% lana.<br />Made in Italy.</p><p>Stiamo preparando i primi maglioni LuckyLap. La stessa passione per i dettagli, in una nuova parte del guardaroba.</p><a class="text-link" href="https://luckylap.com/pages/contact" target="_blank" rel="noopener noreferrer">Chiedici un aggiornamento ${icon("arrow")}</a></div></section>
  <section class="world-section" aria-labelledby="world-title"><div class="world-grid"><div><h2 id="world-title">Prima dei capi,<br />la passione.</h2><p>LuckyLap nasce da due appassionati di auto a Milano. Volevamo portare con noi le linee che amiamo, anche lontano dai circuiti.</p><a class="text-link" href="/pages/about-us">Entra nel nostro mondo ${icon("arrow")}</a></div><img src="/media/world-founders.webp" alt="I fondatori LuckyLap indossano una T-shirt navy e una bianca con silhouette ricamate" width="974" height="974" loading="lazy" /></div></section>
  <section class="partner-section" aria-labelledby="partner-title"><h2 id="partner-title">La passione<br />ci mette insieme.</h2><div><p>Un club, un evento, un negozio. Se condividiamo lo stesso mondo, possiamo immaginare un progetto insieme.</p><a class="btn btn-light" href="/pages/club-eventi">Scopri come collaborare ${icon("arrow")}</a></div></section>`;
}

function catalogPage(category) {
  const caps = category === "caps";
  const title = caps ? "Cappellini,\ncon carattere." : "La tua auto.\nLa tua T-shirt.";
  return `<div class="catalog-page"><div class="page-intro"><h1>${title.replace("\n", "<br />")}</h1><p>${caps ? "Visiera curva, cotone lavato e un ricamo che racconta qualcosa di te." : "Sei silhouette, un modo personale di portare la tua passione. Cotone biologico e ricami a macchina realizzati in Italia."}</p></div><section class="collection-section" aria-label="Catalogo LuckyLap"><div class="catalog-tools"><div class="filter-tabs" role="group" aria-label="Categoria del catalogo"><a class="btn ${caps ? "btn-outline" : "btn-primary"}" href="/collections/t-shirt" ${!caps ? 'aria-current="page"' : ""}>T-shirt</a><a class="btn ${caps ? "btn-primary" : "btn-outline"}" href="/collections/accessories" ${caps ? 'aria-current="page"' : ""}>Cappellini</a></div><label><span class="sr-only">Ordina i prodotti</span><select class="catalog-sort" id="catalog-sort"><option value="featured">La selezione LuckyLap</option><option value="price-asc">Prezzo crescente</option><option value="price-desc">Prezzo decrescente</option></select></label></div><p class="catalog-count">${products.filter((p) => p.category === category).length} modelli</p><div class="shop-grid" id="catalog-products">${products
    .filter((p) => p.category === category)
    .map(card)
    .join("")}</div></section></div>`;
}

function sizeGuide() {
  return `<p>Confronta le misure con una T-shirt che indossi già, stesa in piano. La larghezza del petto è metà della circonferenza.</p><table class="size-table"><caption class="sr-only">Misure del capo in centimetri</caption><thead><tr><th scope="col">Taglia</th><th scope="col">Petto</th><th scope="col">Lunghezza</th></tr></thead><tbody>${[
    ["XS", 45, 67],
    ["S", 48, 69],
    ["M", 51, 71],
    ["L", 54, 73],
    ["XL", 57, 75],
    ["XXL", 60, 77],
  ]
    .map(
      ([size, chest, length]) =>
        `<tr><th scope="row">${size}</th><td>${chest} cm</td><td>${length} cm</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function optionControls(product) {
  const data = getLive(product);
  if (!data?.options || data.error)
    return `<p class="availability-note">${catalogState === "loading" ? "Stiamo verificando taglie e disponibilità…" : "La disponibilità non è raggiungibile in questo momento."}</p><a class="btn btn-primary" href="${product.url}" target="_blank" rel="noopener noreferrer">Verifica nello shop ${icon("arrow")}</a>${catalogState === "error" ? '<button class="text-link" data-retry-catalog>Riprova il caricamento</button>' : ""}`;
  const variant = findVariant(product);
  return `<form class="product-form" id="preview-product-form">${data.options
    .map((option, index) => {
      const optionName = typeof option === "string" ? option : option.name;
      const values = option.values || [...new Set(data.variants.map((v) => v.options[index]))];
      if (values.length === 1 && values[0] === "Default Title") return "";
      const label = /size|taglia/i.test(optionName)
        ? "Taglia"
        : /colou?r|colore/i.test(optionName)
          ? "Colore"
          : optionName;
      return `<fieldset class="option-group"><legend>${escapeHtml(label)}: <span>${escapeHtml(selectedOptions[index])}</span></legend><div class="option-values">${values
        .map((value) => {
          const available = data.variants.some((v) => v.available && v.options[index] === value);
          return `<button type="button" data-option-index="${index}" data-option-value="${escapeHtml(value)}" aria-pressed="${selectedOptions[index] === value}" ${!available ? 'data-unavailable="true"' : ""}>${escapeHtml(value)}</button>`;
        })
        .join("")}</div></fieldset>`;
    })
    .join(
      "",
    )}<button class="btn btn-primary" type="submit" ${variant?.available ? "" : "disabled"}>${variant?.available ? "Aggiungi alla borsa" : "Variante non disponibile"} ${icon("plus")}</button><p class="availability-note" role="status">${variant?.available ? "Disponibile nella variante selezionata." : "Prova un’altra combinazione di taglia e colore."}</p></form>`;
}

function productPage(product) {
  selectedProduct = product;
  const data = getLive(product);
  const requestedVariant = Number(new URLSearchParams(location.search).get("variant"));
  const initial =
    data?.variants?.find((v) => v.id === requestedVariant) ||
    data?.variants?.find((v) => v.available) ||
    data?.variants?.[0];
  selectedOptions = initial?.options ? [...initial.options] : [];
  imageIndex = 0;
  return `<article class="product-page"><nav class="breadcrumbs" aria-label="Ti trovi qui"><a href="/">Home</a><span>/</span><a href="/collections/${product.category === "tshirts" ? "t-shirt" : "accessories"}">${product.category === "tshirts" ? "T-shirt" : "Cappellini"}</a><span>/</span><span>${escapeHtml(product.name)}</span></nav><div class="product-layout"><div class="product-gallery"><div class="product-main-image"><img id="product-image" src="${escapeHtml(fullImageUrl(initial?.image) || product.image)}" alt="${escapeHtml(initial?.image ? `${productName(product)}, ${initial.options.join(" / ")}` : product.alt)}" width="960" height="960" fetchpriority="high" /></div><div class="gallery-thumbs" role="group" aria-label="Immagini del capo"><button data-product-image="0" aria-label="Guarda il capo intero" aria-pressed="true"><img src="${escapeHtml(fullImageUrl(initial?.image) || product.thumb)}" alt="" width="240" height="240" /></button><button data-product-image="1" aria-label="Guarda ${escapeHtml(product.viewLabel.toLowerCase())}" aria-pressed="false"><img src="${product.detailImage}" alt="" width="${product.detailWidth}" height="${product.detailHeight}" /></button></div></div><div class="product-summary"><h1>${escapeHtml(productName(product))}</h1><p class="product-subtitle">${escapeHtml(product.description)}</p><div class="product-price-line"><span class="product-price" id="selected-price">${priceOf(product)}</span></div><p class="product-tax">Imposte incluse. <a href="https://luckylap.com/policies/shipping-policy" target="_blank" rel="noopener noreferrer">Spedizione</a> calcolata al checkout.</p><div id="product-options">${optionControls(product)}</div><div class="product-accordions">${product.category === "tshirts" ? `<details><summary>Trova la tua taglia</summary><div class="details-content">${sizeGuide()}</div></details>` : ""}<details><summary>Materiali e ricamo</summary><div class="details-content"><p>${product.category === "tshirts" ? "T-shirt in cotone biologico pettinato. Vestibilità regular unisex. Disegni originali LuckyLap e ricami a macchina realizzati in Italia." : "Cotone lavato, visiera curva e chiusura regolabile. Ricami LuckyLap."}</p><p>${product.category === "tshirts" ? "Il luogo del ricamo non indica il luogo di produzione dell’intero capo." : "Consulta la scheda ufficiale per tutte le caratteristiche del capo."}</p></div></details><details><summary>Consegna e resi</summary><div class="details-content"><p>Destinazione e contenuto dell’ordine determinano le opzioni di spedizione, verificate prima del pagamento sullo shop.</p><p>Hai 30 giorni dalla consegna per richiedere un reso, secondo le condizioni pubblicate.</p><a href="https://luckylap.com/policies/refund-policy" target="_blank" rel="noopener noreferrer">Leggi la politica di reso</a></div></details><details><summary>Un regalo da riconoscere</summary><div class="details-content"><p>Parti dall’auto che ama e confronta la taglia con un capo che indossa già. Le T-shirt arrivano nella confezione LuckyLap.</p></div></details></div><div class="product-reassurance"><p>${product.category === "tshirts" ? "Ricamo a macchina in Italia" : "Chiusura regolabile"}</p><p>Assistenza prima e dopo l’acquisto</p></div></div></div><section class="product-detail-banner"><img src="${product.detailImage}" alt="${escapeHtml(product.detailAlt)}" width="${product.detailWidth}" height="${product.detailHeight}" loading="lazy" /><div><h2>È il dettaglio<br />che riconosci.</h2><p>${product.category === "tshirts" ? "Un profilo familiare, disegnato da noi e trasformato in ricamo. Il resto lo racconti tu, indossandolo." : "Un richiamo discreto alla tua passione. Da abbinare ai capi che indossi ogni giorno."}</p></div></section></article>`;
}

function aboutPage() {
  return `<article class="content-page"><h1>Prima dei capi,<br />la passione per le auto.</h1><p class="content-lead">Siamo due appassionati di auto a Milano. LuckyLap nasce dal desiderio di portare quella passione nei vestiti di ogni giorno, attraverso un dettaglio che chi ama le auto riconosce.</p><section class="content-split"><img src="/media/world-founders.webp" alt="I fondatori LuckyLap con le loro T-shirt ricamate" width="974" height="974" /><div><h2>Le linee che<br />ci uniscono.</h2><p>Una silhouette sul petto. La firma sulla manica. Disegniamo le grafiche e le facciamo ricamare a macchina in Italia sulle nostre T-shirt in cotone biologico.</p><p>Per chi sceglie un’auto anche con gli occhi. Per chi cerca un ricordo da indossare. Per chi ha una passione da condividere.</p><a class="btn btn-primary" href="/collections/t-shirt">Trova la tua T-shirt ${icon("arrow")}</a></div></section><section class="content-split"><div><h2>Il ricamo,<br />da vicino.</h2><p>Il nostro modo di raccontare le auto parte dal disegno. Ogni modello conserva i suoi tratti riconoscibili, lasciando spazio a chi lo indossa.</p><a class="text-link" href="/pages/club-eventi">Immagina un progetto con noi ${icon("arrow")}</a></div><img src="/media/project88-tee-detail.webp" alt="Dettaglio della monoposto Project ’88 ricamata a colori sul cotone bianco" width="1200" height="800" loading="lazy" /></section></article>`;
}

function partnerPage() {
  return `<article class="content-page"><h1>Una passione.<br />Il vostro progetto.</h1><p class="content-lead">Club, eventi e negozi condividono con noi il piacere di riconoscersi in un dettaglio. Possiamo valutare insieme un capo dedicato, una presenza dal vivo o una proposta per il vostro pubblico.</p><section class="partner-paths"><div class="partner-path"><h2>Un capo per il club.</h2><p>Un progetto co-firmato, con un disegno dedicato e il vostro logo. Partiamo dall’idea, poi definiamo insieme fattibilità, tempi e gestione.</p><a class="btn btn-primary" href="https://luckylap.com/pages/contact" target="_blank" rel="noopener noreferrer">Raccontaci il progetto ${icon("arrow")}</a></div><div class="partner-path"><h2>Incontriamoci dal vivo.</h2><p>Uno stand, un incontro o un assortimento per il negozio. Prima di decidere, confrontiamoci sul pubblico, sugli spazi e sul lavoro da organizzare.</p><a class="btn btn-outline" href="https://luckylap.com/pages/contact" target="_blank" rel="noopener noreferrer">Parliamo dell’opportunità ${icon("arrow")}</a></div></section><section class="content-split"><img src="/media/gt3rs-tee-detail.webp" alt="Dettaglio della silhouette GT3 RS ricamata sul cotone navy" width="1200" height="800" loading="lazy" /><div><h2>Un progetto chiaro,<br />dall’inizio.</h2><p>Ci raccontate chi siete e cosa avete in mente. Noi valutiamo il prodotto e la proposta adatti. Prima di partire definiamo responsabilità, quantità e condizioni, senza impegni anticipati.</p><a class="text-link" href="/collections/t-shirt">Conosci la collezione ${icon("arrow")}</a></div></section></article>`;
}

function renderRoute({ scroll = true } = {}) {
  const path = window.location.pathname;
  selectedProduct = undefined;
  if (path.startsWith("/products/")) {
    const product = products.find((p) => productUrl(p) === path);
    main.innerHTML = product
      ? productPage(product)
      : `<section class="content-page"><h1>Questo capo non è nella selezione.</h1><a class="btn btn-primary" href="/collections/t-shirt">Torna alla collezione</a></section>`;
    document.title = product ? `${productName(product)} — LuckyLap` : "Collezione — LuckyLap";
  } else if (path.startsWith("/collections/")) {
    currentCategory = path.includes("accessories") ? "caps" : "tshirts";
    main.innerHTML = catalogPage(currentCategory);
    document.title = `${currentCategory === "caps" ? "Cappellini" : "T-shirt"} — LuckyLap`;
  } else if (path === "/pages/about-us") {
    main.innerHTML = aboutPage();
    document.title = "Il nostro mondo — LuckyLap";
  } else if (path === "/pages/club-eventi") {
    main.innerHTML = partnerPage();
    document.title = "Club ed eventi — LuckyLap";
  } else {
    main.innerHTML = home();
    document.title = "LuckyLap — La passione si riconosce.";
  }
  if (scroll) {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (location.hash)
      requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
  }
}

async function loadCatalog() {
  catalogState = "loading";
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error("unavailable");
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("invalid");
    liveCatalog = new Map(items.map((item) => [item.handle, item]));
    catalogState = items.some((item) => !item.error) ? "ready" : "error";
  } catch {
    catalogState = "error";
  }
  document.querySelectorAll("[data-price]").forEach((node) => {
    const product = products.find((p) => p.id === node.dataset.price);
    if (product) node.textContent = priceOf(product);
  });
  if (selectedProduct) {
    const data = getLive(selectedProduct);
    if (!selectedOptions.length) {
      const requestedVariant = Number(new URLSearchParams(location.search).get("variant"));
      selectedOptions = [
        ...(data?.variants?.find((v) => v.id === requestedVariant)?.options ||
          data?.variants?.find((v) => v.available)?.options ||
          data?.variants?.[0]?.options ||
          []),
      ];
    }
    updateProductOptions();
  }
  updateCartCount();
  if (document.querySelector("#cart-dialog").open) renderCart();
}

function updateProductOptions() {
  const product = selectedProduct;
  if (!product) return;
  document.querySelector("#product-options").innerHTML = optionControls(product);
  const variant = findVariant(product);
  const thumbnail = document.querySelector('[data-product-image="0"] img');
  if (thumbnail) thumbnail.src = fullImageUrl(variant?.image) || product.thumb;
  document.querySelector("#selected-price").textContent = Number.isFinite(variant?.price)
    ? money.format(variant.price / 100)
    : priceOf(product);
  if (imageIndex === 0) {
    const image = document.querySelector("#product-image");
    image.src = fullImageUrl(variant?.image) || product.image;
    image.alt = variant?.image
      ? `${productName(product)}, ${selectedOptions.join(" / ")}`
      : product.alt;
  }
}

function saveCart() {
  try {
    sessionStorage.setItem("luckylap-studio-bag", JSON.stringify(cart));
  } catch {
    /* La borsa resta disponibile in memoria. */
  }
  updateCartCount();
}
function updateCartCount() {
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  document.querySelectorAll("[data-cart-count]").forEach((node) => {
    node.textContent = count;
  });
  document
    .querySelector("[data-open-cart]")
    .setAttribute(
      "aria-label",
      `Apri la tua borsa, ${count} ${count === 1 ? "articolo" : "articoli"}`,
    );
}
function openDialog(id) {
  const dialog = document.querySelector(id);
  returnFocus = document.activeElement;
  if (!dialog.open) dialog.showModal();
  if (id === "#menu-dialog")
    document.querySelector("[data-open-menu]").setAttribute("aria-expanded", "true");
}
function closeDialog(dialog) {
  if (!dialog?.open) return;
  dialog.close();
  if (dialog.id === "menu-dialog")
    document.querySelector("[data-open-menu]").setAttribute("aria-expanded", "false");
  if (returnFocus?.isConnected) returnFocus.focus();
}
function toast(message) {
  const node = document.querySelector(".toast");
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 3000);
}

function renderCart() {
  const target = document.querySelector("#cart-content");
  if (!cart.length) {
    target.innerHTML = `<div class="cart-empty"><h3>Il tuo prossimo<br />dettaglio è qui.</h3><p>La borsa è ancora vuota. Parti dall’auto che ti rappresenta.</p><a class="btn btn-primary" href="/collections/t-shirt">Esplora le T-shirt ${icon("arrow")}</a></div>`;
    return;
  }
  let total = 0;
  let allVerified = true;
  const lines = cart
    .map((line) => {
      const product = products.find((p) => p.id === line.productId);
      const variant = getLive(product)?.variants?.find((v) => v.id === line.variantId);
      if (!variant?.available) allVerified = false;
      if (variant) total += variant.price * line.quantity;
      return `<div class="cart-line"><a href="${productUrl(product)}"><img src="${escapeHtml(fullImageUrl(variant?.image) || product.thumb)}" alt="${escapeHtml(variant?.image ? `${productName(product)}, ${variant.title}` : product.alt)}" width="240" height="240" /></a><div><div class="cart-line-head"><a href="${productUrl(product)}">${escapeHtml(productName(product))}</a><span>${variant ? money.format((variant.price * line.quantity) / 100) : "Da verificare"}</span></div><p class="cart-line-options">${escapeHtml(variant?.title || "Disponibilità da verificare")}</p><div class="cart-line-controls"><div class="quantity-control"><button data-cart-change="${line.variantId}" data-change="-1" aria-label="Riduci la quantità di ${escapeHtml(productName(product))}">${icon("minus")}</button><output aria-label="Quantità">${line.quantity}</output><button data-cart-change="${line.variantId}" data-change="1" aria-label="Aumenta la quantità di ${escapeHtml(productName(product))}" ${line.quantity >= 10 ? "disabled" : ""}>${icon("plus")}</button></div><button class="remove-line" data-cart-remove="${line.variantId}">Rimuovi</button></div></div></div>`;
    })
    .join("");
  const permalink = `https://luckylap.com/cart/${cart.map((line) => `${line.variantId}:${line.quantity}`).join(",")}`;
  target.innerHTML = `<div class="cart-lines">${lines}</div><div class="cart-total"><div class="cart-total-row"><span>Totale articoli</span><span>${money.format(total / 100)}</span></div><p>Imposte incluse. Spedizione ed eventuali sconti vengono verificati nello shop prima del pagamento.</p>${allVerified ? `<a class="btn btn-primary" href="${permalink}" target="_blank" rel="noopener noreferrer">Continua su LuckyLap ${icon("arrow")}</a>` : '<p class="error-message">Una variante non è disponibile o non è stata verificata. Rimuovila o controlla il capo nello shop.</p>'}<p class="cart-preview-note">Stai provando la nuova esperienza. L’acquisto si completa nello shop LuckyLap attuale.</p></div>`;
}

function search(query = "") {
  const normalized = query.trim().toLocaleLowerCase("it");
  const matches = products.filter((p) =>
    `${p.name} ${p.title} ${p.category === "caps" ? "cappellino" : "maglietta"}`
      .toLocaleLowerCase("it")
      .includes(normalized),
  );
  document.querySelector("#search-results").innerHTML = matches.length
    ? matches
        .map(
          (p) =>
            `<a class="search-result" href="${productUrl(p)}"><img src="${p.thumb}" alt="" width="240" height="240" /><div>${escapeHtml(productName(p))}</div><span>${priceOf(p)}</span></a>`,
        )
        .join("")
    : '<p class="search-empty">Nessun capo trovato. Prova il nome dell’auto o “cappellino”.</p>';
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.matches("[data-open-cart]")) {
    renderCart();
    openDialog("#cart-dialog");
  }
  if (button?.matches("[data-open-search]")) {
    search();
    openDialog("#search-dialog");
    document.querySelector("#site-search").focus();
  }
  if (button?.matches("[data-open-menu]")) openDialog("#menu-dialog");
  if (button?.matches("[data-close-dialog]")) closeDialog(button.closest("dialog"));
  if (button?.dataset.heroProduct) {
    selectedHero = button.dataset.heroProduct;
    const node = document.querySelector(".featured-picker");
    const focusSelected = () =>
      node.querySelector(`[data-hero-product="${selectedHero}"]`)?.focus({ preventScroll: true });
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document
        .startViewTransition(() => {
          node.innerHTML = heroPicker();
        })
        .updateCallbackDone.then(focusSelected)
        .catch(() => {});
    } else {
      node.innerHTML = heroPicker();
      focusSelected();
    }
  }
  if (button?.dataset.homeFilter) {
    currentCategory = button.dataset.homeFilter;
    document
      .querySelectorAll("[data-home-filter]")
      .forEach((node) =>
        node.setAttribute("aria-pressed", String(node.dataset.homeFilter === currentCategory)),
      );
    document.querySelector("#home-products").innerHTML = products
      .filter((p) => p.category === currentCategory)
      .map(card)
      .join("");
  }
  if (button?.dataset.embroidery) {
    const project = button.dataset.embroidery === "project";
    const image = document.querySelector("#embroidery-image");
    image.src = project ? "/media/project88-tee-detail.webp" : "/media/gt3rs-tee-detail.webp";
    image.alt = project
      ? "Dettaglio della monoposto Project ’88 ricamata a colori sul cotone bianco"
      : "Dettaglio della GT3 RS ricamata sul cotone navy con cartellino LuckyLap";
    document
      .querySelectorAll("[data-embroidery]")
      .forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
  }
  if (button?.hasAttribute("data-option-index")) {
    const index = Number(button.dataset.optionIndex);
    selectedOptions[index] = button.dataset.optionValue;
    imageIndex = 0;
    updateProductOptions();
    document
      .querySelectorAll("[data-product-image]")
      .forEach((node) =>
        node.setAttribute("aria-pressed", String(Number(node.dataset.productImage) === imageIndex)),
      );
    document.querySelectorAll(`[data-option-index="${index}"]`).forEach((node) => {
      if (node.dataset.optionValue === selectedOptions[index]) node.focus({ preventScroll: true });
    });
  }
  if (button?.hasAttribute("data-product-image")) {
    imageIndex = Number(button.dataset.productImage);
    const image = document.querySelector("#product-image");
    const variantImage = findVariant(selectedProduct)?.image;
    image.src =
      imageIndex === 1
        ? selectedProduct.detailImage
        : fullImageUrl(variantImage) || selectedProduct.image;
    image.alt =
      imageIndex === 1
        ? selectedProduct.detailAlt
        : variantImage
          ? `${productName(selectedProduct)}, ${selectedOptions.join(" / ")}`
          : selectedProduct.alt;
    document
      .querySelectorAll("[data-product-image]")
      .forEach((node) =>
        node.setAttribute("aria-pressed", String(Number(node.dataset.productImage) === imageIndex)),
      );
  }
  if (button?.hasAttribute("data-cart-change")) {
    const line = cart.find((l) => l.variantId === Number(button.dataset.cartChange));
    if (line) line.quantity = Math.min(10, line.quantity + Number(button.dataset.change));
    cart = cart.filter((l) => l.quantity > 0);
    saveCart();
    renderCart();
  }
  if (button?.hasAttribute("data-cart-remove")) {
    cart = cart.filter((l) => l.variantId !== Number(button.dataset.cartRemove));
    saveCart();
    renderCart();
  }
  if (button?.hasAttribute("data-retry-catalog")) void loadCatalog();
  const link = event.target.closest("a");
  if (
    !link ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0 ||
    link.target ||
    link.hasAttribute("download")
  )
    return;
  const url = new URL(link.href, location.href);
  if (
    url.origin !== location.origin ||
    !/^\/(?:$|products\/|collections\/|pages\/)/.test(url.pathname)
  )
    return;
  event.preventDefault();
  document.querySelectorAll("dialog[open]").forEach(closeDialog);
  if (url.pathname === location.pathname && url.hash) {
    history.pushState({}, "", url);
    document.querySelector(url.hash)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    return;
  }
  history.pushState({}, "", url);
  renderRoute();
  main.focus({ preventScroll: true });
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "preview-product-form") return;
  event.preventDefault();
  const variant = findVariant(selectedProduct);
  if (!variant?.available) return;
  const line = cart.find((item) => item.variantId === variant.id);
  if (line) line.quantity = Math.min(10, line.quantity + 1);
  else cart.push({ productId: selectedProduct.id, variantId: variant.id, quantity: 1 });
  saveCart();
  renderCart();
  openDialog("#cart-dialog");
  toast("Il tuo capo è nella borsa.");
});
document
  .querySelector("#site-search")
  .addEventListener("input", (event) => search(event.target.value));
document.addEventListener("change", (event) => {
  if (event.target.id !== "catalog-sort") return;
  const items = products.filter((p) => p.category === currentCategory);
  if (event.target.value !== "featured")
    items.sort(
      (a, b) =>
        ((getLive(a)?.price || 0) - (getLive(b)?.price || 0)) *
        (event.target.value === "price-desc" ? -1 : 1),
    );
  document.querySelector("#catalog-products").innerHTML = items.map(card).join("");
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        closeDialog(dialog);
    }
  });
  dialog.addEventListener("close", () => {
    if (dialog.id === "menu-dialog")
      document.querySelector("[data-open-menu]").setAttribute("aria-expanded", "false");
  });
});
window.addEventListener("popstate", () => renderRoute());
document.querySelector("[data-year]").textContent = new Date().getFullYear();
renderRoute({ scroll: false });
updateCartCount();
void loadCatalog();
