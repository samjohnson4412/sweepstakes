import * as esbuild from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

/** Builds build/chrome and build/firefox from the same sources. */
const targets = {
  chrome: (m) => m,
  firefox: (m) => ({
    ...m,
    browser_specific_settings: { gecko: { id: "extension@sweeptrack.app", strict_min_version: "128.0" } },
  }),
};

const manifest = JSON.parse(await readFile("static/manifest.json", "utf8"));
const watch = process.argv.includes("--watch");

for (const [name, transform] of Object.entries(targets)) {
  const outdir = `build/${name}`;
  await mkdir(outdir, { recursive: true });
  await cp("static", outdir, { recursive: true });
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(transform(manifest), null, 2));
  const options = {
    entryPoints: ["src/popup.ts", "src/options.ts", "src/fill.ts"],
    bundle: true,
    format: "iife",
    target: name === "firefox" ? "firefox128" : "chrome120",
    outdir,
    logLevel: "info",
  };
  if (watch) await (await esbuild.context(options)).watch();
  else await esbuild.build(options);
}
