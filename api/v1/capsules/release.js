import {
  appendReleaseEvent,
  assertFreshTimestamp,
  decryptEscrowedKey,
  error,
  getCapsule,
  method,
  normalizeAddress,
  ok,
  readJson,
  requireFields,
  verifySignedMessage,
} from "../../_keyRelease.js";

export default async function handler(req, res) {
  if (!method(req, res, "POST")) return;

  try {
    const body = await readJson(req);
    requireFields(body, [
      "capsuleId",
      "keyId",
      "recipient",
      "shelbyNetwork",
      "blobOwner",
      "blobName",
      "ciphertextDigest",
      "timestamp",
      "recipientMessage",
      "recipientPublicKey",
      "recipientSignature",
    ]);
    assertFreshTimestamp(body.timestamp);

    const record = await getCapsule(body.capsuleId);
    if (!record) throw new Error("Capsule key escrow was not found.");
    if (record.keyId !== body.keyId) throw new Error("Key id does not match escrowed capsule.");
    if (record.recipient !== normalizeAddress(body.recipient)) throw new Error("Only the recipient can release this key.");
    if (record.shelbyNetwork !== body.shelbyNetwork) throw new Error("Shelby network does not match escrowed capsule.");
    if (record.blobOwner !== normalizeAddress(body.blobOwner)) throw new Error("Blob owner does not match escrowed capsule.");
    if (record.blobName !== body.blobName) throw new Error("Blob name does not match escrowed capsule.");
    if (record.ciphertextDigest !== body.ciphertextDigest) throw new Error("Ciphertext digest does not match escrowed capsule.");
    if (Date.now() < record.unlockAt) throw new Error("This capsule is still locked.");

    verifySignedMessage({
      expectedAddress: body.recipient,
      expectedMessage: body.recipientMessage,
      publicKey: body.recipientPublicKey,
      signed: body.recipientSignature,
    });

    const key = await decryptEscrowedKey(record.encryptedKey);
    await appendReleaseEvent(body.capsuleId, {
      recipient: normalizeAddress(body.recipient),
      timestamp: Number(body.timestamp),
      releasedAt: Date.now(),
      digest: body.ciphertextDigest,
    });

    ok(res, {
      capsuleId: body.capsuleId,
      algorithm: "AES-GCM-256",
      releasedAt: Date.now(),
      key,
    });
  } catch (cause) {
    error(res, cause);
  }
}
