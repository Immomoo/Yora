/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APTOS_API_KEY?: string;
  readonly VITE_SHELBYNET_APTOS_API_KEY?: string;
  readonly VITE_SHELBY_API_KEY?: string;
  readonly VITE_SHELBYNET_API_KEY?: string;
  readonly VITE_SHELBY_TESTNET_API_KEY?: string;
  readonly VITE_YORA_KEY_RELEASE_URL?: string;
  readonly VITE_YORA_KEY_RELEASE_PUBLIC_KEY?: string;
  readonly VITE_YORA_REGISTRY_ADDRESS?: string;
  readonly VITE_YORA_SHELBYNET_REGISTRY_ADDRESS?: string;
  readonly VITE_YORA_TESTNET_REGISTRY_ADDRESS?: string;
  readonly VITE_YORA_NETWORK?: "testnet" | "shelbynet";
  readonly VITE_NORA_NETWORK?: "testnet" | "shelbynet";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  var Buffer: typeof import("buffer").Buffer;
}

export {};
