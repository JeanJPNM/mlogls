// @ts-check
import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const contexts = await Promise.all([
  esbuild.context({
    outdir: "dist",
    bundle: true,
    platform: "neutral",
    packages: "external",
    logLevel: "info",
    sourcemap: isDev,
    entryPoints: ["src/server.ts"],
    target: "es2020",
    format: "esm",
  }),
  esbuild.context({
    outdir: "dist",
    bundle: true,
    packages: "external",
    platform: "node",
    logLevel: "info",
    sourcemap: isDev,
    entryPoints: ["src/bin.ts"],
    target: "es2020",
    format: "esm",
  }),
]);

console.log("building...");
if (watchMode) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
  console.log("done");
}
