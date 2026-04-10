import { lezer } from "@lezer/generator/rollup";
import path from "node:path";
import { defineConfig } from "vitepress";
import fs from "node:fs/promises";
import jsYaml from "js-yaml";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "mlogls",
  description: "Mindustry Logic made convenient",
  srcDir: "pages",
  base: "/mlogls/",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Docs", link: "/docs/usage" },
      { text: "Playground", link: "/playground" },
      {
        text: "Other resources",
        items: [
          {
            text: "Mlog Documentation",
            link: "https://yrueii.github.io/MlogDocs/",
          },
          {
            text: "MlogJS compiler",
            link: "https://mlogjs.github.io/mlogjs/",
          },
          {
            text: "Mindcode compiler",
            link: "https://mindcode.herokuapp.com/",
          },
        ],
      },
    ],
    sidebar: {
      "/docs/": [
        { text: "Getting Started", link: "/docs/usage" },
        { text: "Language Features", link: "/docs/language-features" },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/JeanJPNM/mlogls" },
    ],
  },
  markdown: {
    async shikiSetup(shiki) {
      const grammarPath = path.resolve(
        __dirname,
        "../../mlogls-vscode/syntaxes/mlog.tmLanguage.yaml"
      );
      const grammar = await fs.readFile(grammarPath, "utf-8");
      const json = jsYaml.load(grammar) as any;
      await shiki.loadLanguage({
        ...json,
        name: "mlog",
        displayName: "Mindustry Logic",
      });
    },
  },
  vite: {
    resolve: {
      alias: {
        events: "events",
        "@": path.resolve(__dirname, "../src"),
      },
    },
    plugins: [lezer()],
  },
});
