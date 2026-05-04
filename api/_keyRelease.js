import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";

const JSON_HEADERS = { "Content-Type": "application/json" };
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function method(req, res, expected) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  if (req.method !== expected) {
    json(res, 405, { error: `Use ${expected}.` });
    return false;
  }
  return true;
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function normalizeHex(value) {
  if (typeof value !== "string" || !value) throw new Error("Expected a hex string.");
  return value.startsWith("0x") ? value : `0x${value}`;
}

export function normalizeAddress(value) {
  return normalizeHex(value).toLowerCase();
}

export function requireFields(body, fields) {
  fields.forEach((field) => {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      throw new Error(`Missing required field: ${field}.`);
    }
  });
}

export function verifySignedMessage({ expectedAddress, expectedMessage, publicKey, signed }) {
  requireFields({ publicKey, signed }, ["publicKey", "signed"]);
  if (!signed || typeof signed !== "object") throw new Error("Signed payload is invalid.");
  requireFields(signed, ["fullMessage", "message", "signature"]);
  if (signed.message !== expectedMessage) throw new Error("Signed message does not match request payload.");
  if (signed.address && normalizeAddress(signed.address) !== normalizeAddress(expectedAddress)) {
    throw new Error("Signed address does not match request address.");
  }

  const key = new Ed25519PublicKey(normalizeHex(publicKey));
  const signature = new Ed25519Signature(normalizeHex(signed.signature));
  const valid = key.verifySignature({
    message: new TextEncoder().encode(signed.fullMessage),
    signature,
  });
  if (!valid) throw new Error("Wallet signature verification failed.");

  const derived = key.authKey().derivedAddress().toString().toLowerCase();
  if (derived !== normalizeAddress(expectedAddress)) {
    throw new Error("Public key does not derive the requested account address.");
  }
}

export function assertFreshTimestamp(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new Error("Timestamp is invalid.");
  if (Math.abs(Date.now() - value) > MAX_CLOCK_SKEW_MS) {
    throw new Error("Signed request timestamp is outside the allowed window.");
  }
}

async function kvCommand(command) {
  const url = requireEnv("YORA_KV_REST_API_URL");
  const token = requireEnv("YORA_KV_REST_API_TOKEN");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `KV command failed with status ${response.status}.`);
  }
  const payload = await response.json();
  return payload.result;
}

export async function saveCapsule(record) {
  await kvCommand(["SET", `yora:capsule:${record.capsuleId}`, JSON.stringify(record)]);
}

export async function getCapsule(capsuleId) {
  const value = await kvCommand(["GET", `yora:capsule:${capsuleId}`]);
  return value ? JSON.parse(value) : null;
}

export async function appendReleaseEvent(capsuleId, event) {
  await kvCommand(["LPUSH", `yora:release-events:${capsuleId}`, JSON.stringify(event)]);
}

export async function decryptEscrowedKey(encryptedKeyBase64) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(requireEnv("YORA_KEY_RELEASE_PRIVATE_KEY"), "base64"),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    Buffer.from(encryptedKeyBase64, "base64"),
  );
  return Buffer.from(decrypted).toString("base64");
}

export function error(res, cause) {
  const message = cause instanceof Error ? cause.message : "Unexpected key-release service error.";
  json(res, message.includes("not configured") ? 503 : 400, { error: message });
}

export function ok(res, payload) {
  json(res, 200, payload);
}
