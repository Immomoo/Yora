import type { CapsuleDraft, EncryptedPayload } from "../types";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesToArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptDraft(draft: CapsuleDraft): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

  const payload = draft.file
    ? new Uint8Array(await draft.file.arrayBuffer())
    : new TextEncoder().encode(draft.message);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesToArrayBuffer(iv) }, key, bytesToArrayBuffer(payload)),
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));

  return {
    iv,
    ciphertext,
    keyBytes: rawKey,
    digest: await sha256Hex(ciphertext),
    sizeBytes: payload.byteLength,
    mimeType: draft.file?.type || "text/plain;charset=utf-8",
    payloadKind: draft.file ? "file" : "message",
  };
}

export async function decryptPayload(
  ciphertext: Uint8Array,
  rawKey: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bytesToArrayBuffer(rawKey), "AES-GCM", false, [
    "decrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
      key,
      bytesToArrayBuffer(ciphertext),
    ),
  );
}
