import { copyFile, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const previewRoot = resolve(packageRoot, "..");
const themeRoot = join(packageRoot, "theme");
const outputPath = join(packageRoot, "luckylap-studio.zip");
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
]) {
  await copyFile(join(previewRoot, "media", source), join(themeRoot, "assets", destination));
}
for (const file of [
  "layout/theme.liquid",
  "templates/index.json",
  "templates/product.json",
  "templates/cart.json",
  "assets/theme.js",
]) {
  await access(join(themeRoot, file));
}
const result = spawnSync(
  "python3",
  [
    "-c",
    `
import pathlib,sys,zipfile,hashlib
root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2])
allowed={'assets','config','layout','locales','sections','snippets','templates','blocks'}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file() and not path.is_symlink() and path.relative_to(root).parts[0] in allowed and path.name != '.DS_Store':
            archive.write(path,path.relative_to(root).as_posix())
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
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
