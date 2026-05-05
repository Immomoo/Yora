import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import type { CapsuleManifest } from "../types";
import type { ShelbyNetworkId } from "../types";
import type { RegistryVerification } from "../types";
import { sameAddress } from "./address";
import { SHELBY_NETWORKS } from "./shelby";

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

function textHex(value: string): string {
  return `0x${Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function valueAt(source: unknown, key: string): unknown {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function bytesToText(value: unknown): string {
  if (Array.isArray(value)) {
    return new TextDecoder().decode(new Uint8Array(value.map((item) => numberValue(item))));
  }
  if (typeof value === "string" && value.startsWith("0x")) {
    const hex = value.slice(2);
    const bytes = hex.match(/.{1,2}/g)?.map((item) => Number.parseInt(item, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  return typeof value === "string" ? value : "";
}

function registryClient(network: ShelbyNetworkId): Aptos {
  return new Aptos(new AptosConfig({ network: SHELBY_NETWORKS[network].aptosNetwork }));
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

export function registryStatusLabel(verification?: RegistryVerification): string {
  if (!verification) return "Registry unchecked";
  if (verification.status === "verified") return "Verified on Aptos";
  if (verification.status === "released") return "Released on Aptos";
  if (verification.status === "missing") return "Registry record missing";
  if (verification.status === "mismatch") return "Registry mismatch";
  return "Registry unavailable";
}

export function registryStatusClass(verification?: RegistryVerification): "ready" | "locked" | "warning" | "shelby" {
  if (!verification) return "shelby";
  if (verification.status === "verified" || verification.status === "released") return "ready";
  if (verification.status === "missing" || verification.status === "mismatch") return "warning";
  return "locked";
}

export async function verifyCapsuleRegistry(
  capsule: CapsuleManifest,
  network: ShelbyNetworkId,
): Promise<RegistryVerification> {
  const registryAddress = aptosRegistryAddress(network);
  const checkedAt = Date.now();

  if (!registryAddress) {
    return {
      status: "unavailable",
      checkedAt,
      released: false,
      message: "Aptos registry is not configured for this Yora route.",
    };
  }

  try {
    const [rawRecord] = await registryClient(network).viewJson<[unknown]>({
      payload: {
        function: `${registryAddress}::yora_registry::get_capsule`,
        typeArguments: [],
        functionArguments: [registryAddress, textHex(capsule.id)],
      },
    });

    const record = rawRecord as Record<string, unknown>;
    const released = Boolean(valueAt(record, "released"));
    const releasedAtSecs = numberValue(valueAt(record, "released_at_secs"));
    const mismatches: string[] = [];
    const unlockAtSecs = Math.floor(capsule.unlockAt / 1000);

    if (!sameAddress(String(valueAt(record, "creator") ?? ""), capsule.creator)) mismatches.push("sender");
    if (!sameAddress(String(valueAt(record, "recipient") ?? ""), capsule.recipient)) mismatches.push("recipient");
    if (!sameAddress(String(valueAt(record, "blob_owner") ?? ""), capsule.creator)) mismatches.push("blob owner");
    if (numberValue(valueAt(record, "unlock_at_secs")) !== unlockAtSecs) mismatches.push("unlock time");
    if (bytesToText(valueAt(record, "shelby_network")) !== (capsule.shelbyNetwork ?? network)) mismatches.push("Shelby network");
    if (bytesToText(valueAt(record, "blob_name")) !== capsule.blobName) mismatches.push("blob name");
    if (bytesToText(valueAt(record, "ciphertext_digest")) !== capsule.ciphertextDigest) mismatches.push("ciphertext digest");
    if (bytesToText(valueAt(record, "payload_kind")) !== capsule.payloadKind) mismatches.push("payload type");
    if (numberValue(valueAt(record, "size_bytes")) !== capsule.sizeBytes) mismatches.push("payload size");

    if (mismatches.length) {
      return {
        status: "mismatch",
        checkedAt,
        released,
        releasedAt: releasedAtSecs ? releasedAtSecs * 1000 : undefined,
        message: `Aptos registry record differs from Shelby capsule data: ${mismatches.join(", ")}.`,
        mismatches,
      };
    }

    return {
      status: released ? "released" : "verified",
      checkedAt,
      released,
      releasedAt: releasedAtSecs ? releasedAtSecs * 1000 : undefined,
      message: released ? "Registry record is verified and marked released." : "Registry record is verified on Aptos.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Yora could not read the Aptos registry.";
    const isMissing =
      message.includes("E_CAPSULE_MISSING") ||
      message.includes("E_NOT_INITIALIZED") ||
      message.includes("sub status 4") ||
      message.includes("sub status 2");

    return {
      status: isMissing ? "missing" : "unavailable",
      checkedAt,
      released: false,
      message: isMissing ? "No matching Aptos registry record was found for this capsule." : message,
    };
  }
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
