import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const outdir = "build";
await mkdir(outdir, { recursive: true });
await cp("static", outdir, { recursive: true });

const options = {
  entryPoints: ["src/popup.ts", "src/options.ts", "src/fill.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir,
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
