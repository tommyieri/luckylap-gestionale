import { embroideryMorphParts } from "./embroidery-morph.js";

export function embroideryStoryMarkup() {
  return `<section class="embroidery-story" aria-labelledby="motion-title" data-embroidery-story>
    <div class="embroidery-stage">
      <div class="motion-copy">
        <h1 id="motion-title">La passione<br>prende forma.</h1>
        <p>T-shirt per chi ama le auto.<br>Disegni originali. Ricami a macchina<br class="desktop-only"> realizzati in Italia.</p>
        <div class="motion-actions"><a class="btn btn-light" data-motion-product href="/products/gt3rs-tshirt">Scopri la GT3 RS <svg aria-hidden="true"><use href="/icons.svg#arrow"></use></svg></a><a class="motion-skip" href="#collezione">Vai alla collezione</a></div>
        <p class="motion-instruction"><svg aria-hidden="true"><use href="/icons.svg#right"></use></svg>Scorri per dare movimento al ricamo.</p>
      </div>
      <div class="motion-media" aria-hidden="true">
        <div class="motion-world">
          <img class="motion-shirt motion-shirt-navy" src="/media/animation-shirt-navy.webp" alt="" width="900" height="1125" fetchpriority="high">
          <img class="motion-shirt motion-shirt-white" src="/media/animation-shirt-white.webp" alt="" width="900" height="1125" loading="eager">
          <div class="motion-car">
            <svg viewBox="0 0 900 300" class="motion-car-art">
              <defs>
                <filter id="motion-white-thread" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  .85 .85 .85 0 -1"/></filter>
                <filter id="motion-red-thread" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  5 -2.5 -2.5 0 -.1"/></filter>
              </defs>
              <svg class="motion-thread-gt3" x="0" y="0" width="900" height="300" viewBox="310 545 590 205" preserveAspectRatio="xMidYMid meet"><image href="/media/gt3rs-tee-detail.webp" width="1200" height="800" filter="url(#motion-white-thread)"/></svg>
              <g class="motion-vector" fill="none" stroke="#f1f3e9" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${embroideryMorphParts.gt3.map((path, index) => `<path data-motion-part="${index}" d="${path}"/>`).join("")}</g>
              <svg class="motion-thread-f40" x="0" y="0" width="900" height="300" viewBox="210 650 640 210" preserveAspectRatio="xMidYMid meet"><image href="/media/f40-tee-detail.webp" width="1086" height="1448" filter="url(#motion-red-thread)"/></svg>
            </svg>
          </div>
        </div>
      </div>
      <div class="motion-selection">
        <div class="motion-models" role="group" aria-label="Esplora il ricamo"><button type="button" data-motion-model="gt3" aria-pressed="true">GT3 RS</button><span aria-hidden="true">→</span><button type="button" data-motion-model="f40" aria-pressed="false">F40</button></div>
        <div class="motion-product-info"><span data-motion-name>GT3 RS · Navy</span><span data-motion-price data-price="gt3rs-tee">Verifica nello shop</span></div>
        <div class="motion-progress" aria-hidden="true"><span></span></div>
        <button class="motion-mode" type="button" data-motion-mode hidden>Riduci il movimento</button>
      </div>
    </div>
  </section>`;
}

export function mountEmbroideryScene(
  root,
  { priceFor = () => "Verifica nello shop", productFor = () => undefined, labels = {} } = {},
) {
  const story = root.querySelector("[data-embroidery-story]");
  if (!story) return () => {};
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  const MorphSVGPlugin = window.MorphSVGPlugin;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const controls = [...story.querySelectorAll("[data-motion-model]")];
  const mode = story.querySelector("[data-motion-mode]");
  let still = reduce.matches;
  let timeline;
  let trigger;
  let context;
  let currentModel;
  let disposed = false;

  function setModel(model) {
    if (currentModel === model) return;
    currentModel = model;
    const f40 = model === "f40";
    const id = f40 ? "f40-tee" : "gt3rs-tee";
    const product = productFor(model);
    controls.forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.motionModel === model)),
    );
    story.querySelector("[data-motion-name]").textContent =
      product?.label || (f40 ? "F40 · Bianco" : "GT3 RS · Navy");
    const price = story.querySelector("[data-motion-price]");
    price.dataset.price = id;
    price.textContent = product?.price || priceFor(id);
    const link = story.querySelector("[data-motion-product]");
    link.href = product?.url || (f40 ? "/products/f40-tshirt" : "/products/gt3rs-tshirt");
    link.firstChild.textContent = product?.actionLabel
      ? `${product.actionLabel} `
      : product?.name
        ? `Scopri ${product.name} `
        : f40
          ? "Scopri la F40 "
          : "Scopri la GT3 RS ";
    story.dataset.model = model;
  }
  function fallback(model = "gt3") {
    story.classList.remove("is-animated");
    story.classList.toggle("is-still-f40", model === "f40");
    setModel(model);
  }
  function rebuild() {
    const remembered = currentModel || "gt3";
    context?.revert();
    timeline = undefined;
    trigger = undefined;
    currentModel = undefined;
    story.classList.remove("is-still-f40");
    if (!gsap || !ScrollTrigger || !MorphSVGPlugin || still) {
      fallback(remembered);
      mode.hidden = !gsap || reduce.matches;
      mode.textContent = still
        ? labels.enableMotion || "Attiva il movimento"
        : labels.reduceMotion || "Riduci il movimento";
      return;
    }
    gsap.registerPlugin(ScrollTrigger, MorphSVGPlugin);
    story.classList.add("is-animated");
    context = gsap.context(() => {
      const world = story.querySelector(".motion-world");
      const car = story.querySelector(".motion-car");
      const navy = story.querySelector(".motion-shirt-navy");
      const white = story.querySelector(".motion-shirt-white");
      const photoGt3 = story.querySelector(".motion-thread-gt3");
      const photoF40 = story.querySelector(".motion-thread-f40");
      const vector = story.querySelector(".motion-vector");
      const progress = story.querySelector(".motion-progress span");
      gsap.set(world, { scale: 4, transformOrigin: "50% 35%" });
      gsap.set(car, {
        scale: 1,
        xPercent: 0,
        yPercent: 0,
        rotation: 0,
        transformOrigin: "50% 50%",
      });
      gsap.set([white, photoF40, vector], { opacity: 0 });
      gsap.set(vector, { stroke: "#f1f3e9" });
      const parts = [...vector.querySelectorAll("[data-motion-part]")];
      parts.forEach((part, index) =>
        gsap.set(part, { attr: { d: embroideryMorphParts.gt3[index] } }),
      );
      timeline = gsap.timeline({
        paused: true,
        defaults: { ease: "none" },
        onUpdate() {
          setModel(timeline.progress() < 0.5 ? "gt3" : "f40");
        },
      });
      timeline
        .to(world, { scale: 1, duration: 1.35 }, 0.35)
        .to(car, { scale: 5.8, xPercent: -120, yPercent: -110, rotation: -3, duration: 1.4 }, 0.45)
        .to(photoGt3, { opacity: 0, duration: 0.35 }, 1.45)
        .to(vector, { opacity: 1, duration: 0.35 }, 1.45)
        .to(navy, { opacity: 0, yPercent: 12, rotation: -6, duration: 0.85 }, 1.7)
        .to(car, { xPercent: 105, yPercent: -130, rotation: 2, duration: 1.4 }, 1.9)
        .to(vector, { stroke: "#efb7aa", duration: 0.85 }, 2.25)
        .fromTo(
          white,
          { yPercent: 15, rotation: 5 },
          { yPercent: 0, rotation: 0, opacity: 1, duration: 1.05 },
          3.05,
        )
        .to(car, { xPercent: 0, yPercent: 0, rotation: 0, scale: 1, duration: 1.35 }, 3.4)
        .to(vector, { opacity: 0, duration: 0.35 }, 3.95)
        .to(photoF40, { opacity: 1, duration: 0.35 }, 3.95)
        .to({}, { duration: 0.55 })
        .fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: 5.3 }, 0);
      parts.forEach((part, index) =>
        timeline.to(
          part,
          {
            morphSVG: {
              shape: embroideryMorphParts.f40[index],
              shapeIndex: 0,
              map: "position",
              type: "linear",
            },
            duration: 0.85,
            ease: "none",
          },
          2.25,
        ),
      );
      trigger = ScrollTrigger.create({
        trigger: story,
        start: "top top",
        end: "bottom bottom",
        animation: timeline,
        scrub: true,
        invalidateOnRefresh: true,
        id: "luckylap-embroidery",
      });
      setModel(timeline.progress() < 0.5 ? "gt3" : "f40");
    }, story);
    mode.hidden = false;
    mode.textContent = labels.reduceMotion || "Riduci il movimento";
    requestAnimationFrame(() => {
      if (!disposed) ScrollTrigger.refresh();
    });
  }
  function choose(event) {
    const model = event.currentTarget.dataset.motionModel;
    if (!trigger || still) {
      fallback(model);
      return;
    }
    const progress = model === "gt3" ? 0.04 : 0.97;
    window.scrollTo({
      top: trigger.start + (trigger.end - trigger.start) * progress,
      behavior: reduce.matches ? "instant" : "smooth",
    });
  }
  function toggleMode() {
    still = !still;
    rebuild();
    window.scrollTo({ top: story.offsetTop, behavior: "instant" });
  }
  function onPreference(event) {
    still = event.matches;
    rebuild();
  }
  controls.forEach((button) => button.addEventListener("click", choose));
  mode.hidden = !gsap;
  mode.addEventListener("click", toggleMode);
  reduce.addEventListener("change", onPreference);
  rebuild();
  document.fonts?.ready.then(() => {
    if (!disposed && trigger) ScrollTrigger.refresh();
  });
  return () => {
    disposed = true;
    context?.revert();
    controls.forEach((button) => button.removeEventListener("click", choose));
    mode.removeEventListener("click", toggleMode);
    reduce.removeEventListener("change", onPreference);
  };
}
