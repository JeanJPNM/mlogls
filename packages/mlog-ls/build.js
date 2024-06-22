// @ts-check
import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

/** @type {esbuild.BuildOptions} */
const commonOptions = {
  outdir: "dist",
  bundle: true,
  platform: "neutral",
  packages: "external",
  logLevel: "info",
  sourcemap: isDev,
};

const contexts = await Promise.all([
  ...createVariants([
    {
      ...commonOptions,
      entryPoints: ["src/server.ts"],
    },
    {
      ...commonOptions,
      entryPoints: ["src/browserServerMain.ts", "src/nodeServerMain.ts"],
      plugins: [
        {
          name: "external-server-ts",
          setup(build) {
            const extension =
              build.initialOptions.format === "esm" ? "js" : "cjs";

            // prevent the contents of server.ts from being
            // duplicated on each of the entry points
            build.onResolve({ filter: /.\/server/ }, () => ({
              path: `./server.${extension}`,
              external: true,
            }));
          },
        },
      ],
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
