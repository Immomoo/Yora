/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APTOS_API_KEY?: string;
  readonly VITE_SHELBYNET_APTOS_API_KEY?: string;
  readonly VITE_SHELBY_API_KEY?: string;
  readonly VITE_SHELBYNET_API_KEY?: string;
  readonly VITE_SHELBY_TESTNET_API_KEY?: string;
  readonly VITE_NORA_NETWORK?: "testnet" | "shelbynet";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  var Buffer: typeof import("buffer").Buffer;
}

export {};
