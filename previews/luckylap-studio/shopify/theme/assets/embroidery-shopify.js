import { mountEmbroideryScene } from "./embroidery-scene.js";

const scenes = new Map();

function sectionsWithin(scope) {
  const sections = [...scope.querySelectorAll("[data-embroidery-section]")];
  if (scope.matches?.("[data-embroidery-section]")) sections.unshift(scope);
  return sections;
}

function mount(scope) {
  sectionsWithin(scope).forEach((section) => {
    if (scenes.has(section)) return;
    const data = section.dataset;
    const products = {
      gt3: {
        url: data.gt3Url,
        name: data.gt3Name,
        label: data.gt3Label,
        price: data.gt3Price,
        actionLabel: data.gt3Action,
      },
      f40: {
        url: data.f40Url,
        name: data.f40Name,
        label: data.f40Label,
        price: data.f40Price,
        actionLabel: data.f40Action,
      },
    };
    const cleanup = mountEmbroideryScene(section, {
      productFor: (model) => products[model],
      priceFor: (id) => products[id === "f40-tee" ? "f40" : "gt3"].price,
      labels: { reduceMotion: data.reduceMotion, enableMotion: data.enableMotion },
    });
    scenes.set(section, cleanup);
    section.querySelectorAll("img").forEach((image) => {
      if (!image.complete) image.addEventListener("load", refresh, { once: true });
    });
  });
}

function refresh() {
  window.ScrollTrigger?.refresh();
}

function unmount(scope) {
  sectionsWithin(scope).forEach((section) => {
    scenes.get(section)?.();
    scenes.delete(section);
    section.querySelectorAll("img").forEach((image) => image.removeEventListener("load", refresh));
  });
}

function initialise() {
  mount(document);
  document.addEventListener("shopify:section:load", (event) => mount(event.target));
  document.addEventListener("shopify:section:unload", (event) => unmount(event.target));
  document.addEventListener("shopify:section:reorder", refresh);
  window.addEventListener("pagehide", () => unmount(document));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) mount(document);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else if (
  document.readyState === "complete" ||
  (window.gsap && window.ScrollTrigger && window.MorphSVGPlugin)
) {
  initialise();
} else {
  window.addEventListener("load", initialise, { once: true });
}
