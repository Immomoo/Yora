import { base64ToBytes, bytesToBase64 } from "./bytes";
import type { CapsuleManifest } from "../types";
import { comparableAddress, sameAddress } from "./address";

const STORE_KEY = "yora:key-release:v1";
const LEGACY_STORE_KEY = "nora:key-release:v1";
const REMOTE_URL = import.meta.env.VITE_YORA_KEY_RELEASE_URL?.trim().replace(/\/$/, "") ?? "";
const REMOTE_PUBLIC_KEY = import.meta.env.VITE_YORA_KEY_RELEASE_PUBLIC_KEY?.trim() ?? "";

interface StoredKey {
  keyId: string;
  recipient: string;
  unlockAt: number;
  key: string;
}

function readKeys(): StoredKey[] {
  try {
    const stored = localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY);
    return JSON.parse(stored || "[]") as StoredKey[];
  } catch {
    return [];
  }
}

function writeKeys(keys: StoredKey[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(keys));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function signaturePayload(signature: unknown): unknown {
  if (!signature || typeof signature !== "object") return signature;
  const value = signature as Record<string, unknown>;
  const signed = value.signature as { toString?: () => string } | string | undefined;
  return {
    address: value.address,
    application: value.application,
    chainId: value.chainId,
    fullMessage: value.fullMessage,
    message: value.message,
    nonce: value.nonce,
    prefix: value.prefix,
    signature: typeof signed === "string" ? signed : signed?.toString?.(),
  };
}

async function encryptKeyForRemote(keyBytes: Uint8Array): Promise<{ encryptedKey: string; keyEncoding: string }> {
  if (!REMOTE_PUBLIC_KEY) {
    throw new Error("Remote key release is enabled, but VITE_YORA_KEY_RELEASE_PUBLIC_KEY is missing.");
  }

  const imported = await crypto.subtle.importKey(
    "spki",
    bytesToArrayBuffer(base64ToBytes(REMOTE_PUBLIC_KEY)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, imported, bytesToArrayBuffer(keyBytes));
  return {
    encryptedKey: bytesToBase64(new Uint8Array(encrypted)),
    keyEncoding: "rsa-oaep-sha256",
  };
}

export function isRemoteKeyReleaseEnabled(): boolean {
  return Boolean(REMOTE_URL);
}

export function keyReleaseModeLabel(): string {
  return isRemoteKeyReleaseEnabled() ? "Remote key-release service" : "Development key vault";
}

export function buildKeyEscrowMessage(capsule: CapsuleManifest): string {
  return [
    "Yora key escrow",
    `Capsule ID: ${capsule.id}`,
    `Recipient: ${capsule.recipient}`,
    `Unlock at: ${capsule.unlockAt}`,
    `Shelby network: ${capsule.shelbyNetwork ?? "testnet"}`,
    `Blob owner: ${capsule.creator}`,
    `Blob name: ${capsule.blobName}`,
    `Digest: ${capsule.ciphertextDigest}`,
  ].join("\n");
}

export function buildKeyReleaseMessage(capsule: CapsuleManifest, timestamp: number): string {
  return [
    "Yora key release",
    `Capsule ID: ${capsule.id}`,
    `Recipient: ${capsule.recipient}`,
    `Timestamp: ${timestamp}`,
    `Shelby network: ${capsule.shelbyNetwork ?? "testnet"}`,
    `Blob owner: ${capsule.creator}`,
    `Blob name: ${capsule.blobName}`,
    `Digest: ${capsule.ciphertextDigest}`,
  ].join("\n");
}

export async function escrowKey(params: {
  keyId: string;
  recipient: string;
  unlockAt: number;
  keyBytes: Uint8Array;
  capsule?: CapsuleManifest;
  creatorSignature?: unknown;
  creatorMessage?: string;
  creatorPublicKey?: string;
}): Promise<void> {
  if (isRemoteKeyReleaseEnabled()) {
    if (!params.capsule || !params.creatorSignature || !params.creatorMessage) {
      throw new Error("Remote key escrow requires a capsule manifest and creator signature.");
    }

    const encrypted = await encryptKeyForRemote(params.keyBytes);
    const response = await fetch(`${REMOTE_URL}/v1/capsules/escrow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capsuleId: params.capsule.id,
        keyId: params.keyId,
        creator: params.capsule.creator,
        recipient: params.capsule.recipient,
        unlockAt: params.capsule.unlockAt,
        shelbyNetwork: params.capsule.shelbyNetwork ?? "testnet",
        blobOwner: params.capsule.creator,
        blobName: params.capsule.blobName,
        ciphertextDigest: params.capsule.ciphertextDigest,
        payloadKind: params.capsule.payloadKind,
        sizeBytes: params.capsule.sizeBytes,
        encryptedKey: encrypted.encryptedKey,
        keyEncoding: encrypted.keyEncoding,
        creatorMessage: params.creatorMessage,
        creatorPublicKey: params.creatorPublicKey,
        creatorSignature: signaturePayload(params.creatorSignature),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `Remote key escrow failed with status ${response.status}.`);
    }
    return;
  }

  const keys = readKeys().filter((key) => key.keyId !== params.keyId);
  keys.push({
    keyId: params.keyId,
    recipient: comparableAddress(params.recipient),
    unlockAt: params.unlockAt,
    key: bytesToBase64(params.keyBytes),
  });
  writeKeys(keys);
}

export async function releaseKey(params: {
  keyId: string;
  recipient: string;
  capsule?: CapsuleManifest;
  recipientSignature?: unknown;
  recipientMessage?: string;
  recipientPublicKey?: string;
  timestamp?: number;
  now?: number;
}): Promise<Uint8Array> {
  if (isRemoteKeyReleaseEnabled()) {
    if (!params.capsule || !params.recipientSignature || !params.recipientMessage || !params.timestamp) {
      throw new Error("Remote key release requires capsule details and recipient signature.");
    }

    const response = await fetch(`${REMOTE_URL}/v1/capsules/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capsuleId: params.capsule.id,
        keyId: params.keyId,
        recipient: params.recipient,
        shelbyNetwork: params.capsule.shelbyNetwork ?? "testnet",
        blobOwner: params.capsule.creator,
        blobName: params.capsule.blobName,
        ciphertextDigest: params.capsule.ciphertextDigest,
        timestamp: params.timestamp,
        recipientMessage: params.recipientMessage,
        recipientPublicKey: params.recipientPublicKey,
        recipientSignature: signaturePayload(params.recipientSignature),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `Remote key release failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as { key?: string };
    if (!payload.key) throw new Error("Remote key release did not return a decrypt key.");
    return base64ToBytes(payload.key);
  }

  const found = readKeys().find((key) => key.keyId === params.keyId);
  if (!found) {
    throw new Error(
      "The release key is not available in this browser. Enable the remote key-release service, or unseal from the same browser session that sealed this capsule.",
    );
  }
  if (!sameAddress(found.recipient, params.recipient)) {
    throw new Error("Connect the recipient wallet for this capsule.");
  }
  if ((params.now ?? Date.now()) < found.unlockAt) {
    throw new Error("This capsule is still locked.");
  }
  return base64ToBytes(found.key);
}
