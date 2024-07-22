// @ts-check
import * as esbuild from "esbuild";
import chokidar from "chokidar";
import jsYaml from "js-yaml";
import * as fs from "node:fs/promises";

const syntaxFile = "syntaxes/mlog.tmLanguage.yaml";

const watchMode = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const contexts = await Promise.all([
  esbuild.context({
    entryPoints: ["src/browserClient.ts", "src/browserServer.ts"],
    bundle: true,
    outdir: "dist",
    target: "es2020",
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
    target: "es2020",
    platform: "node",
    logLevel: "info",
    sourcemap: isDev,
    external: [
      "vscode",
      // we don't need to bundle these in dev mode
      // since require() works fine
      ...(isDev ? ["mlogls", "vscode-languageclient"] : []),
    ],
  }),
]);

console.log("building...");
if (watchMode) {
  const watcher = chokidar.watch(syntaxFile, {
    atomic: true,
  });

  watcher.on("change", buildLanguageSyntax).on("ready", buildLanguageSyntax);

  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all([
    ...contexts.map((context) => context.rebuild()),
    buildLanguageSyntax(),
  ]);
  await Promise.all(contexts.map((context) => context.dispose()));

  console.log("done");
}

async function buildLanguageSyntax() {
  if (watchMode) {
    console.log(`[watch] build started (${syntaxFile})`);
  }
  const yaml = await fs.readFile(syntaxFile, "utf-8");

  try {
    const json = jsYaml.load(yaml, {
      filename: syntaxFile,
      onWarning: console.warn,
    });

    const jsonPath = syntaxFile.replace(".yaml", ".json");

    await fs.writeFile(jsonPath, JSON.stringify(json, null, 2));
    if (watchMode) {
      console.log(`[watch] build finished ${syntaxFile} -> ${jsonPath}`);
    } else {
      console.log(`built ${syntaxFile} -> ${jsonPath}`);
    }
  } catch (e) {
    console.error(e);
  }
}
