/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

interface ImportMetaEnv {
  VITE_POSTHOG_TOKEN?: string;
}
