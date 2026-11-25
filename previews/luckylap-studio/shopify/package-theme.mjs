import { copyFile, readFile, writeFile, access, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { shippingPolicyMarkup } from "./shipping-policy.mjs";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const previewRoot = resolve(packageRoot, "..");
const themeRoot = join(packageRoot, "theme");
const outputPath = join(packageRoot, "luckylap-studio.zip");
const assetsOnly = process.argv.includes("--assets-only");
const css = (await readFile(join(previewRoot, "style.css"), "utf8"))
  .replaceAll("/media/mona-400.ttf", "mona-400.ttf")
  .replaceAll("/media/mona-500.ttf", "mona-500.ttf");
await writeFile(join(themeRoot, "assets/studio.css"), css);
for (const [source, destination] of [
  ["world-lifestyle.webp", "hero.webp"],
  ["gt3rs-tee-detail.webp", "story.webp"],
  ["world-founders.webp", "founders.webp"],
  ["logo-original.png", "logo-original.png"],
  ["mona-400.ttf", "mona-400.ttf"],
  ["mona-500.ttf", "mona-500.ttf"],
  ["LICENSE-MonaSans.txt", "LICENSE-MonaSans.txt"],
  ["animation-shirt-navy.webp", "animation-shirt-navy.webp"],
  ["animation-shirt-white.webp", "animation-shirt-white.webp"],
  ["gt3rs-tee-detail.webp", "gt3rs-tee-detail.webp"],
  ["f40-tee-detail.webp", "f40-tee-detail.webp"],
]) {
  await copyFile(join(previewRoot, "media", source), join(themeRoot, "assets", destination));
}
for (const file of ["embroidery-scene.js", "embroidery-scene.css", "embroidery-morph.js"]) {
  await copyFile(join(previewRoot, file), join(themeRoot, "assets", file));
}
await rm(join(themeRoot, "assets", "embroidery-art.js"), { force: true });
for (const file of [
  "gsap-3.15.1.min.js",
  "ScrollTrigger-3.15.1.min.js",
  "MorphSVGPlugin-3.15.1.min.js",
]) {
  await copyFile(join(previewRoot, "vendor", file), join(themeRoot, "assets", file));
}
for (const file of [
  "layout/theme.liquid",
  "templates/index.json",
  "templates/product.json",
  "templates/cart.json",
  "assets/theme.js",
  "sections/embroidery-hero.liquid",
  "assets/embroidery-shopify.js",
]) {
  await access(join(themeRoot, file));
}
if (assetsOnly) {
  console.log("Asset del tema aggiornati. Archivio ZIP non generato.");
  process.exit(0);
}
let packagedSettings = null;
if (process.env.LUCKYLAP_SHIPPING_POLICY_PATH) {
  const policy = JSON.parse(await readFile(process.env.LUCKYLAP_SHIPPING_POLICY_PATH, "utf8"));
  const settings = JSON.parse(await readFile(join(themeRoot, "config/settings_data.json"), "utf8"));
  settings.current.shipping_policy_text = shippingPolicyMarkup(policy);
  packagedSettings = settings;
}
const result = spawnSync(
  "python3",
  [
    "-c",
    `
import pathlib,sys,zipfile,hashlib,json
root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2])
settings=json.load(sys.stdin)
allowed={'assets','config','layout','locales','sections','snippets','templates','blocks'}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file() and not path.is_symlink() and path.relative_to(root).parts[0] in allowed and path.name != '.DS_Store':
            relative=path.relative_to(root).as_posix()
            if relative == 'config/settings_data.json' and settings is not None:
                archive.writestr(relative,json.dumps(settings,ensure_ascii=False,indent=2)+'\\n')
            else:
                archive.write(path,relative)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'layout/theme.liquid' in archive.namelist()
print(str(output))
print('SHA-256 '+hashlib.sha256(output.read_bytes()).hexdigest())
print(str(output.stat().st_size)+' bytes')
`,
    themeRoot,
    outputPath,
  ],
  { input: JSON.stringify(packagedSettings), stdio: ["pipe", "inherit", "inherit"] },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
