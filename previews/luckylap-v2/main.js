import { categories, products } from "./catalog.js";

const $ = (selector) => document.querySelector(selector);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const storageKey = "luckylap-wardrobe-v2";
const byId = new Map(products.map((product) => [product.id, product]));
const first = byId.get("964-tee") || products[0];
const state = { product: first, detail: false, zoom: 1.25, panX: 0, panY: 0 };
const categoryMemory = new Map([[first.category, first.id]]);
const selection = new Map();
const animations = new Set();
const image = $("#product-image");
const stage = $("#image-stage");
const artwork = $("#artwork");
let request = 0;
let worldRequest = 0;
let pointer = null;
let pointerFrame = 0;
let toastTimer;
let loadingTimer;

function stopAnimation(element) {
  for (const animation of element.getAnimations()) animation.cancel();
}

function animate(element, frames, options = {}) {
  if (reduced.matches) return null;
  stopAnimation(element);
  const animation = element.animate(frames, {
    duration: 560,
    easing: "cubic-bezier(.22,1,.36,1)",
    ...options,
  });
  animations.add(animation);
  animation.finished.catch(() => {}).finally(() => animations.delete(animation));
  return animation;
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("is-visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("is-visible"), 2600);
}

function restoreSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return;
    for (const id of saved) {
      const product = byId.get(id);
      if (product) selection.set(product.category, product.id);
    }
  } catch {
    // La selezione resta utilizzabile anche quando lo storage non è disponibile.
  }
}

function persistSelection() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...selection.values()]));
  } catch {
    // Nessun account o servizio esterno: la pagina continua a funzionare in memoria.
  }
}

function sourceFor(product, detail) {
  return detail ? product.detailImage : product.image;
}

async function decoded(source) {
  const candidate = new Image();
  candidate.src = source;
  await candidate.decode();
  return candidate;
}

function updateSelectionControls() {
  const count = selection.size;
  const current = selection.get(state.product.category) === state.product.id;
  $("#selection-count").textContent = String(count);
  $("#selection-context").textContent = `${count} capi scelti`;
  $("#add-label").textContent = current ? "Nella tua selezione" : "Scegli questo capo";
  $("#add-icon").setAttribute("href", `icons.svg#${current ? "check" : "plus"}`);
  $("#add-selection").classList.toggle("is-selected", current);
  $("#add-selection").setAttribute(
    "aria-label",
    current
      ? `Nella tua selezione: ${state.product.title}. Scelto, apri il tuo abbinamento`
      : `Scegli questo capo: ${state.product.title} per il tuo abbinamento`,
  );
}

function renderRail() {
  const rail = $("#product-rail");
  const members = products.filter((product) => product.category === state.product.category);
  rail.replaceChildren();
  for (const product of members) {
    const button = document.createElement("button");
    button.className = "product-option";
    button.dataset.product = product.id;
    button.setAttribute("aria-pressed", String(product.id === state.product.id));
    button.setAttribute(
      "aria-label",
      `${product.name}, ${categories.find((category) => category.id === product.category).label}, ${product.colorLabel}`,
    );
    const thumbnail = new Image(48, 48);
    thumbnail.src = product.thumb;
    thumbnail.alt = "";
    thumbnail.draggable = false;
    const label = document.createElement("span");
    label.textContent = product.name;
    button.append(thumbnail, label);
    button.addEventListener("click", () => {
      const from = members.findIndex((item) => item.id === state.product.id);
      const to = members.indexOf(product);
      selectProduct(product, { direction: to >= from ? 1 : -1, focusRail: true });
    });
    rail.append(button);
  }
}

function updateRail({ focus = false } = {}) {
  for (const button of document.querySelectorAll("[data-product]")) {
    const active = button.dataset.product === state.product.id;
    button.setAttribute("aria-pressed", String(active));
    if (active) {
      if (focus) button.focus({ preventScroll: true });
      const rail = $("#product-rail");
      const left =
        button.offsetLeft - rail.offsetLeft - (rail.clientWidth - button.clientWidth) / 2;
      rail.scrollTo({ left, behavior: reduced.matches ? "instant" : "smooth" });
    }
  }
}

function renderProduct() {
  const product = state.product;
  $("#product-name").textContent = product.name;
  $("#product-color").textContent = product.colorLabel;
  $("#product-description").textContent = product.description;
  $("#product-link").href = product.url;
  $("#product-link").setAttribute("aria-label", `Vedi nello shop: ${product.title}, nuova scheda`);
  $("#model-ghost").textContent = product.name;
  $("#model-ghost").classList.toggle("is-long", product.name.length > 5);
  document.documentElement.style.setProperty("--ground", product.imageBackground);
  $("meta[name='theme-color']").content = product.imageBackground;
  for (const button of document.querySelectorAll("[data-category]")) {
    if (button.dataset.category !== "knitwear")
      button.setAttribute("aria-pressed", String(button.dataset.category === product.category));
  }
  image.src = sourceFor(product, state.detail);
  image.alt = state.detail ? product.detailAlt : product.alt;
  image.width = state.detail ? product.detailWidth : product.imageWidth;
  image.height = state.detail ? product.detailHeight : product.imageHeight;
  artwork.classList.toggle("is-detail", state.detail);
  $("#detail-toggle").setAttribute("aria-pressed", String(state.detail));
  $("#detail-toggle-label").textContent = state.detail ? "Il capo" : "Da vicino";
  $("#detail-icon").setAttribute("href", `icons.svg#${state.detail ? "reset" : "zoom"}`);
  $("#zoom-controls").hidden = !state.detail;
  $("#detail-view-label").textContent = product.viewLabel;
  $("#zoom").value = String(state.zoom);
  stage.setAttribute(
    "aria-label",
    state.detail
      ? `${product.viewLabel}. Trascina per esplorare, usa più e meno per lo zoom, Escape per tornare al capo.`
      : `${product.title}. Usa le frecce destra e sinistra o trascina per cambiare capo.`,
  );
  stage.setAttribute("aria-describedby", state.detail ? "detail-view-label" : "gesture-hint");
  $("#gesture-hint").textContent = "Trascina per cambiare icona";
  updateSelectionControls();
  applyPan();
}

async function selectProduct(
  product,
  { direction = 1, detail = state.detail, focusRail = false } = {},
) {
  if (!product) return;
  const ticket = ++request;
  clearTimeout(loadingTimer);
  $("#stage-status").textContent = "";
  if (product.id === state.product.id && detail === state.detail) {
    stage.removeAttribute("aria-busy");
    return;
  }
  stage.setAttribute("aria-busy", "true");
  loadingTimer = setTimeout(() => {
    if (ticket === request) $("#stage-status").textContent = "Caricamento del capo…";
  }, 250);
  try {
    await decoded(sourceFor(product, detail));
    if (ticket !== request) return;
    clearTimeout(loadingTimer);
    const previous = image.cloneNode();
    previous.removeAttribute("id");
    previous.alt = "";
    previous.setAttribute("aria-hidden", "true");
    previous.className = "outgoing";
    stage.querySelectorAll(".outgoing").forEach((node) => node.remove());
    if (!reduced.matches) stage.append(previous);
    const categoryChanged = product.category !== state.product.category;
    const modeChanged = detail !== state.detail;
    if (pointer) endPointer({ pointerId: pointer.id }, true);
    state.product = product;
    state.detail = detail;
    state.zoom = detail ? 1.25 : 1;
    state.panX = 0;
    state.panY = 0;
    categoryMemory.set(product.category, product.id);
    renderProduct();
    if (categoryChanged) renderRail();
    updateRail({ focus: focusRail });
    const outgoing = animate(
      previous,
      [
        { opacity: 1, transform: "translateX(0) scale(1)" },
        {
          opacity: 0,
          transform: `translateX(${-direction * (modeChanged ? 24 : 90)}px) scale(${modeChanged ? 1.08 : 0.96})`,
        },
      ],
      { duration: 440 },
    );
    if (outgoing) outgoing.finished.catch(() => {}).finally(() => previous.remove());
    const targetTransform = state.detail
      ? `translate(0px,0px) scale(${state.zoom})`
      : "translateX(0) rotate(0deg)";
    animate(
      image,
      [
        {
          opacity: 0,
          transform: `translateX(${direction * (modeChanged ? 20 : 130)}px) scale(${modeChanged ? 1.06 : 0.98}) rotate(${modeChanged ? 0 : direction * 2}deg)`,
        },
        { opacity: 1, transform: targetTransform },
      ],
      { duration: modeChanged ? 700 : 660 },
    );
    animate($("#model-ghost"), [
      { opacity: 0, transform: `translate(${direction * 50}px,-50%)` },
      { opacity: 1, transform: "translate(0,-50%)" },
    ]);
    animate(
      $("#product-copy"),
      [
        { opacity: 0.15, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 440 },
    );
    $("#stage-status").textContent = "";
  } catch {
    if (ticket === request)
      $("#stage-status").textContent = "La foto non si è caricata. Riprova a scegliere il capo.";
  } finally {
    if (ticket === request) {
      clearTimeout(loadingTimer);
      stage.removeAttribute("aria-busy");
    }
  }
}

function stepProduct(direction) {
  const members = products.filter((product) => product.category === state.product.category);
  const index = members.findIndex((product) => product.id === state.product.id);
  selectProduct(members[(index + direction + members.length) % members.length], { direction });
}

function applyPan() {
  const box = stage.getBoundingClientRect();
  const maxX = (box.width * Math.max(0, state.zoom - 1)) / 2;
  const maxY = (box.height * Math.max(0, state.zoom - 1)) / 2;
  state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
  state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
  stage.style.setProperty("--zoom", String(state.zoom));
  stage.style.setProperty("--pan-x", `${state.panX}px`);
  stage.style.setProperty("--pan-y", `${state.panY}px`);
}

function openDialog(dialog) {
  for (const open of document.querySelectorAll("dialog[open]")) open.close();
  if (dialog.id === "selection-dialog") renderSelection();
  dialog.showModal();
  animate(
    dialog,
    [
      {
        opacity: 0,
        transform: dialog.classList.contains("selection-dialog")
          ? "translateX(48px)"
          : "translateY(24px) scale(.98)",
      },
      { opacity: 1, transform: "translate(0) scale(1)" },
    ],
    { duration: 440 },
  );
}

function renderSelection() {
  const container = $("#selection-items");
  container.replaceChildren();
  const selected = categories.flatMap((category) => byId.get(selection.get(category.id)) || []);
  $("#selection-empty").hidden = selected.length > 0;
  $("#selection-note").hidden = selected.length === 0;
  for (const product of selected) {
    const row = document.createElement("article");
    row.className = "selection-row";
    const thumb = new Image(104, 112);
    thumb.src = product.thumb;
    thumb.alt = product.alt;
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = product.name;
    const label = document.createElement("p");
    label.textContent = `${categories.find((category) => category.id === product.category).label}, ${product.colorLabel}`;
    const shop = document.createElement("a");
    shop.className = "shop-link";
    shop.textContent = "Vedi nello shop ↗";
    shop.href = product.url;
    shop.target = "_blank";
    shop.rel = "noopener noreferrer";
    shop.setAttribute("aria-label", `Vedi nello shop: ${product.title}, nuova scheda`);
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "Rimuovi";
    remove.setAttribute("aria-label", `Rimuovi ${product.title} dalla selezione`);
    remove.addEventListener("click", () => {
      selection.delete(product.category);
      persistSelection();
      updateSelectionControls();
      renderSelection();
      $("#selection-dialog [data-close]").focus();
    });
    content.append(title, label, shop, remove);
    row.append(thumb, content);
    container.append(row);
  }
}

function addToSelection() {
  if (selection.get(state.product.category) === state.product.id) {
    openDialog($("#selection-dialog"));
    return;
  }
  selection.set(state.product.category, state.product.id);
  persistSelection();
  updateSelectionControls();
  toast(`${state.product.name} nella tua selezione.`);
  animate(
    $("#selection-count"),
    [
      { transform: "translateY(6px)", opacity: 0.2 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 360 },
  );
  if (reduced.matches) return;
  const from = image.getBoundingClientRect();
  const to = $(".selection-trigger").getBoundingClientRect();
  const flight = new Image();
  flight.src = state.product.thumb;
  flight.alt = "";
  flight.setAttribute("aria-hidden", "true");
  flight.className = "selection-flight";
  const startX = from.left + from.width * 0.5 - 36;
  const startY = from.top + from.height * 0.45 - 36;
  Object.assign(flight.style, {
    width: "72px",
    height: "72px",
    left: `${startX}px`,
    top: `${startY}px`,
  });
  document.body.append(flight);
  const animation = animate(
    flight,
    [
      { opacity: 0.95, transform: "translate(0,0) scale(1.3)" },
      {
        opacity: 0,
        transform: `translate(${to.left + to.width / 2 - startX - 36}px,${to.top + to.height / 2 - startY - 36}px) scale(.25)`,
      },
    ],
    { duration: 740 },
  );
  animation?.finished.catch(() => {}).finally(() => flight.remove());
}

const worlds = {
  culture: {
    title: "La cultura dei motori.",
    description:
      "Silhouette, storie e dettagli che riconosci al primo sguardo. È da questa passione che nasce LuckyLap.",
    image: "media/world-monza.webp",
    alt: "Una vettura da gara nel paddock di Monza",
  },
  people: {
    title: "Un progetto condiviso.",
    description:
      "Due fondatori, una passione per il motorsport e il design. Da qui è nato LuckyLap.",
    image: "media/world-founders.webp",
    alt: "I fondatori di LuckyLap con i capi del brand nel paddock",
  },
  everyday: {
    title: "Anche fuori dalla pista.",
    description:
      "Il ricamo sul cotone, la firma sulla manica. La stessa passione, nella vita di tutti i giorni.",
    image: "media/world-lifestyle.webp",
    alt: "La T-shirt GT3 RS LuckyLap navy indossata nella vita quotidiana",
  },
};

for (const button of document.querySelectorAll("[data-world]")) {
  button.addEventListener("click", async () => {
    const ticket = ++worldRequest;
    const world = worlds[button.dataset.world];
    $(".world-status")?.remove();
    try {
      await decoded(world.image);
      if (ticket !== worldRequest) return;
      $(".world-status")?.remove();
      $("#world-image").src = world.image;
      $("#world-image").alt = world.alt;
      $("#world-image").classList.toggle("is-people", button.dataset.world === "people");
      $("#world-title").textContent = world.title;
      $("#world-description").textContent = world.description;
      document
        .querySelectorAll("[data-world]")
        .forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      animate(
        $("#world-image"),
        [
          { opacity: 0.4, transform: "scale(1.04)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 620 },
      );
    } catch {
      if (ticket !== worldRequest) return;
      let error = $(".world-status");
      if (!error) {
        error = document.createElement("p");
        error.className = "world-status";
        error.setAttribute("role", "status");
        $(".world-copy").append(error);
      }
      error.textContent = "La foto non si è caricata. Riprova.";
    }
  });
}

$("#previous").addEventListener("click", () => stepProduct(-1));
$("#next").addEventListener("click", () => stepProduct(1));
$("#detail-toggle").addEventListener("click", () =>
  selectProduct(state.product, { detail: !state.detail }),
);
$("#add-selection").addEventListener("click", addToSelection);
$("#zoom").addEventListener("input", (event) => {
  stopAnimation(image);
  state.zoom = Number(event.target.value);
  applyPan();
});
$("#reset-zoom").addEventListener("click", () => {
  stopAnimation(image);
  state.zoom = 1.25;
  state.panX = 0;
  state.panY = 0;
  $("#zoom").value = String(state.zoom);
  applyPan();
});
for (const button of document.querySelectorAll("[data-category]")) {
  button.addEventListener("click", () => {
    const category = categories.find((item) => item.id === button.dataset.category);
    if (category.status === "soon") {
      openDialog($("#soon-dialog"));
      return;
    }
    const product =
      byId.get(categoryMemory.get(category.id)) ||
      products.find((item) => item.category === category.id);
    selectProduct(product, { direction: category.id === "caps" ? 1 : -1 });
  });
}
for (const button of document.querySelectorAll("[data-open]"))
  button.addEventListener("click", () => openDialog(document.getElementById(button.dataset.open)));
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => button.closest("dialog").close());
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      dialog.close();
  });
}

stage.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  stopAnimation(image);
  stage.setPointerCapture(event.pointerId);
  pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: state.panX,
    panY: state.panY,
    dx: 0,
    dy: 0,
    detail: state.detail,
  };
});
stage.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer.dx = event.clientX - pointer.x;
  pointer.dy = event.clientY - pointer.y;
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    if (!pointer) return;
    if (pointer.detail) {
      state.panX = pointer.panX + pointer.dx;
      state.panY = pointer.panY + pointer.dy;
      applyPan();
    } else if (Math.abs(pointer.dx) > Math.abs(pointer.dy)) {
      stage.style.setProperty("--drag-x", `${pointer.dx * 0.28}px`);
      stage.style.setProperty("--drag-r", `${Math.max(-3, Math.min(3, pointer.dx / 85))}deg`);
    }
  });
});
function endPointer(event, cancelled = false) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const previous = pointer;
  pointer = null;
  stage.style.setProperty("--drag-x", "0px");
  stage.style.setProperty("--drag-r", "0deg");
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  if (
    !previous.detail &&
    !cancelled &&
    Math.abs(previous.dx) > 55 &&
    Math.abs(previous.dx) > Math.abs(previous.dy) * 1.3
  )
    stepProduct(previous.dx < 0 ? 1 : -1);
}
stage.addEventListener("pointerup", (event) => endPointer(event));
stage.addEventListener("pointercancel", (event) => endPointer(event, true));
stage.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const handled = state.detail
    ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)
    : ["ArrowLeft", "ArrowRight"].includes(event.key);
  if (!handled) return;
  event.preventDefault();
  stopAnimation(image);
  if (!state.detail && event.key === "ArrowLeft") stepProduct(-1);
  else if (!state.detail && event.key === "ArrowRight") stepProduct(1);
  else if (state.detail) {
    if (event.key === "ArrowLeft") state.panX += 30;
    if (event.key === "ArrowRight") state.panX -= 30;
    if (event.key === "ArrowUp") state.panY += 30;
    if (event.key === "ArrowDown") state.panY -= 30;
    if (event.key === "+") state.zoom = Math.min(2.6, state.zoom + 0.15);
    if (event.key === "-") state.zoom = Math.max(1, state.zoom - 0.15);
    $("#zoom").value = String(state.zoom);
    applyPan();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.detail && !document.querySelector("dialog[open]"))
    selectProduct(state.product, { detail: false });
});
new ResizeObserver(() => {
  if (state.detail) applyPan();
}).observe(stage);
reduced.addEventListener("change", () => {
  if (reduced.matches) for (const animation of animations) animation.finish();
});
window.addEventListener("pagehide", () => {
  clearTimeout(toastTimer);
  clearTimeout(loadingTimer);
  cancelAnimationFrame(pointerFrame);
  for (const animation of animations) animation.cancel();
});

restoreSelection();
renderProduct();
renderRail();
document.querySelectorAll("button[disabled]").forEach((button) => (button.disabled = false));
document.documentElement.dataset.ready = "true";
const initialRequest = request;
const initialViewIsCurrent = () =>
  request === initialRequest && state.product.id === first.id && !state.detail;
decoded(first.image)
  .then(() => {
    if (initialViewIsCurrent())
      animate(
        image,
        [
          { opacity: 1, transform: "translateX(30px) scale(.96)" },
          { opacity: 1, transform: "translateX(0) scale(1)" },
        ],
        { duration: 1000 },
      );
  })
  .catch(() => {
    if (initialViewIsCurrent())
      $("#stage-status").textContent = "La foto non si è caricata. Puoi aprire il capo nello shop.";
  });
