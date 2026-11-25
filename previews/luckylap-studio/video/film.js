/* Composizione HyperFrames: una timeline deterministica, nessun clock o input. */
gsap.registerPlugin(MorphSVGPlugin);
const timeline = gsap.timeline({ paused: true });
models.forEach((model, index) => {
  const next = models[(index + 1) % models.length];
  const start = index * 4;
  const scene = document.getElementById("scene-" + index);
  const outgoing = scene.querySelector(".shirt-out");
  const incoming = scene.querySelector(".shirt-in");
  const car = scene.querySelector(".car");
  const currentArt = scene.querySelector(".art-out");
  const nextArt = scene.querySelector(".art-in");
  const vector = scene.querySelector(".art-vector");
  timeline.set(scene, { opacity: 1 }, start);
  timeline.fromTo(
    outgoing,
    { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
    {
      x: -190,
      y: 220,
      rotation: -7,
      scale: 0.9,
      opacity: 0,
      duration: 0.85,
      ease: "power2.in",
      immediateRender: false,
    },
    start + 1.35,
  );
  timeline.fromTo(
    incoming,
    { x: 190, y: 170, rotation: 6, scale: 0.92, opacity: 0 },
    {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      opacity: 1,
      duration: 1.1,
      ease: "power3.out",
      immediateRender: false,
    },
    start + 1.75,
  );
  timeline.fromTo(
    car,
    { x: 0, y: 0, scale: 1, rotation: 0 },
    {
      x: mobile ? -40 : -180,
      y: -110,
      scale: 5.5,
      rotation: -3,
      duration: 1.05,
      ease: "power2.inOut",
      immediateRender: false,
    },
    start + 0.6,
  );
  timeline.to(
    car,
    { x: mobile ? 30 : 90, y: -145, rotation: 1.5, duration: 0.85, ease: "sine.inOut" },
    start + 1.65,
  );
  timeline.to(
    car,
    { x: 0, y: 0, scale: 1, rotation: 0, duration: 1.05, ease: "power3.inOut" },
    start + 2.5,
  );
  timeline.fromTo(
    currentArt,
    { opacity: 1 },
    { opacity: 0, duration: 0.2, immediateRender: false },
    start + 1.5,
  );
  timeline.fromTo(
    vector,
    { opacity: 0 },
    { opacity: 1, duration: 0.2, immediateRender: false },
    start + 1.5,
  );
  timeline.fromTo(
    vector,
    { stroke: model.color },
    { stroke: next.color, duration: 0.65, immediateRender: false },
    start + 1.75,
  );
  vector.querySelectorAll("path").forEach((path, part) => {
    timeline.fromTo(
      path,
      { attr: { d: carParts[model.id][part] } },
      {
        morphSVG: {
          shape: carParts[next.id][part],
          shapeIndex: 0,
          map: "position",
          type: "linear",
        },
        duration: 0.65,
        ease: "sine.inOut",
        immediateRender: false,
      },
      start + 1.75,
    );
  });
  timeline.to(vector, { opacity: 0, duration: 0.25 }, start + 2.4);
  timeline.fromTo(
    nextArt,
    { opacity: 0 },
    { opacity: 1, duration: 0.25, immediateRender: false },
    start + 2.4,
  );
  if (index < models.length - 1) timeline.set(scene, { opacity: 0 }, start + 4);
});
window.__timelines["luckylap-hero"] = timeline;
