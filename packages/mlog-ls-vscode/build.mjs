// @ts-check
import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const contexts = await Promise.all([
  esbuild.context({
    entryPoints: ["src/browserClient.ts", "src/browserServer.ts"],
    bundle: true,
    outdir: "dist",
    format: "cjs",
    platform: "browser",
    logLevel: "info",
    sourcemap: isDev,
    external: ["vscode"],
  }),
  esbuild.context({
    entryPoints: ["src/nodeClient.ts", "src/nodeServer.ts"],
    bundle: true,
    outdir: "dist",
    format: "cjs",
    platform: "node",
    logLevel: "info",
    sourcemap: isDev,
    external: [
      "vscode",
      // we don't need to bundle these in dev mode
      // since require() works fine
      ...(isDev ? ["mlog-ls", "vscode-languageclient"] : []),
    ],
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
