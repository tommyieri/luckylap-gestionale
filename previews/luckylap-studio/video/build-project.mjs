import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { carParts } from "./cars.js";

const source = dirname(fileURLToPath(import.meta.url));
const preview = resolve(source, "..");
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) throw new Error("Indica una cartella di produzione esterna al repository.");
const mobile = process.argv.includes("--mobile");
const width = mobile ? 1080 : 1920;
const height = mobile ? 1920 : 1080;
await mkdir(join(destination, "assets"), { recursive: true });

const models = [
  {
    id: "gt3",
    name: "GT3 RS",
    shirt: "animation-shirt-navy.webp",
    art: "gt3rs-tee-detail.webp",
    imageWidth: 1200,
    imageHeight: 800,
    crop: "310 545 590 205",
    filter: "white-thread",
    color: "#e8e9df",
  },
  {
    id: "sl300",
    name: "300 SL",
    shirt: "animation-shirt-blue.webp",
    art: "300sl-tee-detail.webp",
    imageWidth: 956,
    imageHeight: 1332,
    crop: "170 580 580 190",
    filter: "blue-thread",
    color: "#e8e9df",
  },
  {
    id: "p964",
    name: "964",
    shirt: "animation-shirt-964-white.webp",
    art: "orig-964-drive.png",
    imageWidth: 2300,
    imageHeight: 2300,
    crop: "515 1030 1280 390",
    filter: "black-ink",
    color: "#20251f",
  },
  {
    id: "f40",
    name: "F40",
    shirt: "animation-shirt-white.webp",
    art: "f40-tee-detail.webp",
    imageWidth: 1086,
    imageHeight: 1448,
    crop: "210 650 640 210",
    filter: "red-thread",
    color: "#ac292a",
  },
  {
    id: "tr512",
    name: "512 TR",
    shirt: "animation-shirt-white.webp",
    art: "orig-512tr-drive.png",
    imageWidth: 1946,
    imageHeight: 1946,
    crop: "160 600 1640 440",
    filter: "red-ink",
    color: "#ac292a",
  },
  {
    id: "project88",
    name: "Project ’88",
    shirt: "animation-shirt-project88.webp",
    art: "orig-project88-senna-drive.jpg",
    imageWidth: 1184,
    imageHeight: 880,
    crop: "120 310 950 250",
    filter: "coloured-ink",
    color: "#a52d2a",
  },
];
for (const file of new Set(models.flatMap((model) => [model.shirt, model.art]))) {
  await copyFile(join(preview, "media", file), join(destination, "assets", file));
}
for (const file of ["gsap-3.15.1.min.js", "MorphSVGPlugin-3.15.1.min.js"]) {
  await copyFile(join(preview, "vendor", file), join(destination, "assets", file));
}
const art = (model, index, kind) =>
  `<svg class="art art-${kind}" viewBox="0 0 900 300" aria-hidden="true"><svg viewBox="${model.crop}" width="900" height="300" preserveAspectRatio="xMidYMid meet"><image href="assets/${model.art}" width="${model.imageWidth}" height="${model.imageHeight}" filter="url(#${model.filter})"/></svg></svg>`;
const scenes = models
  .map((model, i) => {
    const next = models[(i + 1) % models.length];
    return `<div class="scene" id="scene-${i}" data-model="${model.name}">
    <div class="shirt shirt-out"><img src="assets/${model.shirt}" alt="${model.name}" width="900" height="1125" style="transform:scale(${/^(gt3|f40|tr512)$/.test(model.id) ? 1.19 : 1})"></div>
    <div class="shirt shirt-in"><img src="assets/${next.shirt}" alt="${next.name}" width="900" height="1125" style="transform:scale(${/^(gt3|f40|tr512)$/.test(next.id) ? 1.19 : 1})"></div>
    <div class="car">${art(model, i, "out")}<svg class="art art-vector" viewBox="0 0 900 300" fill="none" stroke="${model.color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${carParts[model.id].map((d, n) => `<path data-part="${n}" d="${d}"/>`).join("")}</svg>${art(next, i, "in")}</div>
  </div>`;
  })
  .join("\n");
const film = await readFile(join(source, "film.js"), "utf8");
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>LuckyLap — i ricami prendono vita</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:#f4f5f1}
.studio{position:absolute;inset:0;background:radial-gradient(ellipse at 58% 34%,#f4f5f1 10%,#e7ebe3 60%,#b9c3b6 115%)}
.clip,.scene{position:absolute;inset:0;width:100%;height:100%}.scene{opacity:0}
.shirt{position:absolute;width:900px;height:1125px;left:${mobile ? 90 : 650}px;top:${mobile ? 130 : -30}px;transform-origin:50% 35%;filter:drop-shadow(6px 24px 24px #14231c24)}
.shirt img{display:block;width:100%;height:100%;object-fit:contain}.shirt-in{opacity:0}
.car{position:absolute;left:${mobile ? 90 : 650}px;top:${mobile ? 130 : -30}px;width:900px;height:1125px;transform-origin:51.2% 34%;z-index:3}
.art{position:absolute;left:45%;top:32.1%;width:12.4%;height:3.72%;overflow:visible;filter:drop-shadow(0 1px .5px #14231c80)}
.art-in,.art-vector{opacity:0}
</style></head><body>
<div id="root" data-composition-id="luckylap-hero" data-width="${width}" data-height="${height}" data-duration="24">
<div class="studio"></div><svg width="0" height="0" aria-hidden="true"><defs>
<filter id="white-thread" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 .85 .85 .85 0 -1"/></filter>
<filter id="blue-thread" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 .96 0 0 0 0 .97 0 0 0 0 .95 8 0 -4 0 -1.9"/></filter>
<filter id="red-thread" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 5 -2.5 -2.5 0 -.1"/></filter>
<filter id="black-ink"><feFlood flood-color="#20251f"/><feComposite in2="SourceAlpha" operator="in"/></filter>
<filter id="red-ink"><feFlood flood-color="#ac292a"/><feComposite in2="SourceAlpha" operator="in"/></filter>
<filter id="coloured-ink" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 -5 -5 -5 0 14.5"/></filter>
</defs></svg>
<div id="film-body" class="clip" data-start="0" data-duration="24" data-track-index="0">${scenes}</div></div>
<script src="assets/gsap-3.15.1.min.js"></script><script src="assets/MorphSVGPlugin-3.15.1.min.js"></script>
<script>const models=${JSON.stringify(models)};const carParts=${JSON.stringify(carParts)};const mobile=${mobile};\n${film}</script>
</body></html>`;
await writeFile(join(destination, "index.html"), html);
await writeFile(
  join(destination, "hyperframes.json"),
  JSON.stringify({ schemaVersion: 1, name: "LuckyLap — i ricami prendono vita" }, null, 2) + "\n",
);
console.log(`${destination}: ${width}×${height}, 24 secondi, sei grafiche.`);
