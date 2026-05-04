import {
  error,
  method,
  normalizeAddress,
  ok,
  readJson,
  requireFields,
  saveCapsule,
  verifySignedMessage,
} from "../../_keyRelease.js";

export default async function handler(req, res) {
  if (!method(req, res, "POST")) return;

  try {
    const body = await readJson(req);
    requireFields(body, [
      "capsuleId",
      "keyId",
      "creator",
      "recipient",
      "unlockAt",
      "shelbyNetwork",
      "blobOwner",
      "blobName",
      "ciphertextDigest",
      "payloadKind",
      "sizeBytes",
      "encryptedKey",
      "keyEncoding",
      "creatorMessage",
      "creatorPublicKey",
      "creatorSignature",
    ]);

    if (body.keyEncoding !== "rsa-oaep-sha256") {
      throw new Error("Unsupported key encoding.");
    }
    if (normalizeAddress(body.creator) !== normalizeAddress(body.blobOwner)) {
      throw new Error("Blob owner must match capsule creator.");
    }

    verifySignedMessage({
      expectedAddress: body.creator,
      expectedMessage: body.creatorMessage,
      publicKey: body.creatorPublicKey,
      signed: body.creatorSignature,
    });

    await saveCapsule({
      capsuleId: body.capsuleId,
      keyId: body.keyId,
      creator: normalizeAddress(body.creator),
      recipient: normalizeAddress(body.recipient),
      unlockAt: Number(body.unlockAt),
      shelbyNetwork: body.shelbyNetwork,
      blobOwner: normalizeAddress(body.blobOwner),
      blobName: body.blobName,
      ciphertextDigest: body.ciphertextDigest,
      payloadKind: body.payloadKind,
      sizeBytes: Number(body.sizeBytes),
      encryptedKey: body.encryptedKey,
      keyEncoding: body.keyEncoding,
      createdAt: Date.now(),
    });

    ok(res, { capsuleId: body.capsuleId, escrowed: true });
  } catch (cause) {
    error(res, cause);
  }
}
