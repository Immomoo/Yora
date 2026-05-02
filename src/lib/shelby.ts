import { Network } from "@aptos-labs/ts-sdk";
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import type { ShelbyNetworkId } from "../types";

export interface ShelbyNetworkConfig {
  id: ShelbyNetworkId;
  label: string;
  shortLabel: string;
  description: string;
  aptosNetwork: Network.TESTNET | Network.SHELBYNET;
  blobBaseUrl: string;
  apiKey?: string;
}

export const SHELBY_NETWORKS: Record<ShelbyNetworkId, ShelbyNetworkConfig> = {
  shelbynet: {
    id: "shelbynet",
    label: "Shelbynet Devnet",
    shortLabel: "Shelbynet",
    description: "Developer prototype network. Data can be wiped.",
    aptosNetwork: Network.SHELBYNET,
    blobBaseUrl: "https://api.shelbynet.shelby.xyz/shelby/v1/blobs",
    apiKey: import.meta.env.VITE_SHELBYNET_API_KEY ?? import.meta.env.VITE_SHELBY_API_KEY,
  },
  testnet: {
    id: "testnet",
    label: "Shelby Testnet",
    shortLabel: "Testnet",
    description: "Public Shelby test environment.",
    aptosNetwork: Network.TESTNET,
    blobBaseUrl: "https://api.testnet.shelby.xyz/shelby/v1/blobs",
    apiKey: import.meta.env.VITE_SHELBY_TESTNET_API_KEY ?? import.meta.env.VITE_SHELBY_API_KEY,
  },
};

export const DEFAULT_SHELBY_NETWORK: ShelbyNetworkId =
  (import.meta.env.VITE_YORA_NETWORK ?? import.meta.env.VITE_NORA_NETWORK) === "shelbynet" ? "shelbynet" : "testnet";

export function createShelbyClient(network: ShelbyNetworkId): ShelbyClient {
  const config = SHELBY_NETWORKS[network];
  return new ShelbyClient({
    network: config.aptosNetwork,
    apiKey: config.apiKey,
  });
}

export function shelbyBlobUrl(ownerAddress: string, blobName: string, network: ShelbyNetworkId): string {
  const base = SHELBY_NETWORKS[network].blobBaseUrl;
  return `${base}/${ownerAddress}/${encodeURIComponent(blobName)}`;
}
