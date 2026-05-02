import { base64ToBytes, bytesToBase64 } from "./bytes";

const STORE_KEY = "yora:key-release:v1";
const LEGACY_STORE_KEY = "nora:key-release:v1";

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

export async function escrowKey(params: {
  keyId: string;
  recipient: string;
  unlockAt: number;
  keyBytes: Uint8Array;
}): Promise<void> {
  const keys = readKeys().filter((key) => key.keyId !== params.keyId);
  keys.push({
    keyId: params.keyId,
    recipient: params.recipient.toLowerCase(),
    unlockAt: params.unlockAt,
    key: bytesToBase64(params.keyBytes),
  });
  writeKeys(keys);
}

export async function releaseKey(params: {
  keyId: string;
  recipient: string;
  now?: number;
}): Promise<Uint8Array> {
  const found = readKeys().find((key) => key.keyId === params.keyId);
  if (!found) throw new Error("The release key is not available on this device.");
  if (found.recipient !== params.recipient.toLowerCase()) {
    throw new Error("Connect the recipient wallet for this capsule.");
  }
  if ((params.now ?? Date.now()) < found.unlockAt) {
    throw new Error("This capsule is still locked.");
  }
  return base64ToBytes(found.key);
}
