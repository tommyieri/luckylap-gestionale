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
    const cleanup = mountEmbroideryScene(section, {
      labels: {
        pauseVideo: data.pauseVideo,
        pauseVideoLabel: data.pauseVideoLabel,
        playVideo: data.playVideo,
        playVideoLabel: data.playVideoLabel,
        retryVideo: data.retryVideo,
        videoUnavailable: data.videoUnavailable,
      },
    });
    scenes.set(section, cleanup);
  });
}

function unmount(scope) {
  sectionsWithin(scope).forEach((section) => {
    scenes.get(section)?.();
    scenes.delete(section);
  });
}

function initialise() {
  mount(document);
  document.addEventListener("shopify:section:load", (event) => mount(event.target));
  document.addEventListener("shopify:section:unload", (event) => unmount(event.target));
  window.addEventListener("pagehide", () => unmount(document));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) mount(document);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
}
