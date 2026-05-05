export type CapsuleStatus = "draft" | "sealed" | "ready" | "opened";
export type ShelbyNetworkId = "shelbynet" | "testnet";
export type RegistryVerificationStatus = "verified" | "released" | "missing" | "mismatch" | "unavailable";

export interface RegistryVerification {
  status: RegistryVerificationStatus;
  checkedAt: number;
  released: boolean;
  releasedAt?: number;
  message: string;
  mismatches?: string[];
}

export interface CapsuleManifest {
  id: string;
  title: string;
  creator: string;
  recipient: string;
  unlockAt: number;
  createdAt: number;
  payloadKind: "message" | "file";
  blobName: string;
  blobUrl?: string;
  storage: "shelby" | "local";
  sizeBytes: number;
  mimeType: string;
  fileName?: string;
  iv: string;
  keyId: string;
  ciphertextDigest: string;
  registryTxHash?: string;
  releaseTxHash?: string;
  registryVerification?: RegistryVerification;
  status: CapsuleStatus;
  shelbyNetwork?: ShelbyNetworkId;
}

export interface CapsuleDraft {
  title: string;
  recipient: string;
  unlockAt: number;
  message: string;
  file?: File | null;
}

export interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  keyBytes: Uint8Array;
  digest: string;
  sizeBytes: number;
  mimeType: string;
  payloadKind: "message" | "file";
}
