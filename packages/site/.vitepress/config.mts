import { lezer } from "@lezer/generator/rollup";
import path from "path";
import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "mlogls",
  description: "Mindustry Logic made convenient",
  srcDir: "pages",
  base: "/mlogls/",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Usage", link: "/usage" },
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
    sidebar: {},

    socialLinks: [
      { icon: "github", link: "https://github.com/JeanJPNM/mlogls" },
    ],
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
