// @ts-check
import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const contexts = await Promise.all([
  ...createVariants([
    {
      outdir: "dist",
      bundle: true,
      platform: "neutral",
      packages: "external",
      logLevel: "info",
      sourcemap: isDev,
      entryPoints: ["src/server.ts"],
    },
  ]).map(esbuild.context),
]);

console.log("building...");
if (watchMode) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
  console.log("done");
}

/**
 *
 * @param {esbuild.BuildOptions[]} configs
 * @returns {esbuild.BuildOptions[]}
 */
function createVariants(configs) {
  return configs.flatMap((config) => {
    return [
      { ...config, format: "esm" },
      {
        ...config,
        format: "cjs",
        outExtension: {
          ".js": ".cjs",
        },
      },
    ];
  });
}
