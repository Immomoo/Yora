import type { CapsuleManifest } from "../types";

const REGISTRY_ADDRESS = import.meta.env.VITE_YORA_REGISTRY_ADDRESS?.trim() ?? "";

function textBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

export function isAptosRegistryEnabled(): boolean {
  return Boolean(REGISTRY_ADDRESS);
}

export function registryModeLabel(): string {
  return isAptosRegistryEnabled() ? "Aptos registry enabled" : "Aptos registry optional";
}

export function buildRegisterCapsuleTransaction(capsule: CapsuleManifest): unknown {
  if (!REGISTRY_ADDRESS) {
    throw new Error("VITE_YORA_REGISTRY_ADDRESS is not configured.");
  }

  return {
    data: {
      function: `${REGISTRY_ADDRESS}::yora_registry::register_capsule`,
      typeArguments: [],
      functionArguments: [
        REGISTRY_ADDRESS,
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
