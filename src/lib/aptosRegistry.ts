import type { CapsuleManifest } from "../types";
import type { ShelbyNetworkId } from "../types";

const REGISTRY_ADDRESSES: Record<ShelbyNetworkId, string> = {
  shelbynet:
    import.meta.env.VITE_YORA_SHELBYNET_REGISTRY_ADDRESS?.trim() ||
    import.meta.env.VITE_YORA_REGISTRY_ADDRESS?.trim() ||
    "",
  testnet:
    import.meta.env.VITE_YORA_TESTNET_REGISTRY_ADDRESS?.trim() ||
    import.meta.env.VITE_YORA_REGISTRY_ADDRESS?.trim() ||
    "",
};

function textBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

export function aptosRegistryAddress(network: ShelbyNetworkId): string {
  return REGISTRY_ADDRESSES[network];
}

export function isAptosRegistryEnabled(network: ShelbyNetworkId): boolean {
  return Boolean(aptosRegistryAddress(network));
}

export function registryModeLabel(network: ShelbyNetworkId): string {
  return isAptosRegistryEnabled(network) ? "Aptos registry enabled" : "Aptos registry optional";
}

export function buildRegisterCapsuleTransaction(capsule: CapsuleManifest, network: ShelbyNetworkId): unknown {
  const registryAddress = aptosRegistryAddress(network);
  if (!registryAddress) {
    throw new Error(`Aptos registry address is not configured for ${network}.`);
  }

  return {
    data: {
      function: `${registryAddress}::yora_registry::register_capsule`,
      typeArguments: [],
      functionArguments: [
        registryAddress,
        textBytes(capsule.id),
        capsule.recipient,
        String(Math.floor(capsule.unlockAt / 1000)),
        textBytes(capsule.shelbyNetwork ?? "testnet"),
        capsule.creator,
        textBytes(capsule.blobName),
        textBytes(capsule.ciphertextDigest),
        textBytes(capsule.payloadKind),
        String(capsule.sizeBytes),
      ],
    },
  };
}

export function buildMarkReleasedTransaction(capsule: CapsuleManifest, network: ShelbyNetworkId): unknown {
  const registryAddress = aptosRegistryAddress(network);
  if (!registryAddress) {
    throw new Error(`Aptos registry address is not configured for ${network}.`);
  }

  return {
    data: {
      function: `${registryAddress}::yora_registry::mark_released`,
      typeArguments: [],
      functionArguments: [registryAddress, textBytes(capsule.id)],
    },
  };
}
