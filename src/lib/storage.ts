import type { CapsuleManifest } from "../types";
import { decodeCapsuleEnvelope } from "./shelbyCapsules";

const MANIFESTS_KEY = "yora:capsules:v1";
const LEGACY_MANIFESTS_KEY = "nora:capsules:v1";

export function getCapsules(): CapsuleManifest[] {
  try {
    const stored = localStorage.getItem(MANIFESTS_KEY) ?? localStorage.getItem(LEGACY_MANIFESTS_KEY);
    const manifests = JSON.parse(stored || "[]") as CapsuleManifest[];
    return manifests.filter((manifest) => manifest.storage === "shelby");
  } catch {
    return [];
  }
}

export function saveCapsule(capsule: CapsuleManifest): void {
  const capsules = getCapsules().filter((item) => item.id !== capsule.id);
  localStorage.setItem(MANIFESTS_KEY, JSON.stringify([capsule, ...capsules]));
}

export function updateCapsule(id: string, patch: Partial<CapsuleManifest>): CapsuleManifest[] {
  const capsules = getCapsules().map((capsule) =>
    capsule.id === id ? { ...capsule, ...patch } : capsule,
  );
  localStorage.setItem(MANIFESTS_KEY, JSON.stringify(capsules));
  return capsules;
}

export async function readBlob(manifest: CapsuleManifest): Promise<Uint8Array> {
  if (manifest.storage === "local") {
    throw new Error("This capsule was not written to Shelby and cannot be opened in Shelby-only mode.");
  }

  if (!manifest.blobUrl) throw new Error("Shelby blob URL is missing.");
  const response = await fetch(manifest.blobUrl);
  if (!response.ok) throw new Error(`Yora could not read the Shelby blob. Status ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    return decodeCapsuleEnvelope(bytes).ciphertext;
  } catch {
    return bytes;
  }
}
