/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
