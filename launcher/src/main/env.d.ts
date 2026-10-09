interface ImportMetaEnv {
  /** Account server URL baked in at build time (MAIN_VITE_API_ROOT). */
  readonly MAIN_VITE_API_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
