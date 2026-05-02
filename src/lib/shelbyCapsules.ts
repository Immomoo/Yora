import type { ShelbyClient, BlobMetadata } from "@shelby-protocol/sdk/browser";
import type { CapsuleManifest, EncryptedPayload, ShelbyNetworkId } from "../types";
import { base64ToBytes, bytesToBase64 } from "./bytes";
import { addressSlug, sameAddress } from "./address";
import { shelbyBlobUrl } from "./shelby";

const CAPSULE_PREFIX = "yora/v2";

interface CapsuleEnvelope {
  version: 2;
  manifest: CapsuleManifest;
  ciphertext: string;
}

function metadataOwner(metadata: BlobMetadata): string {
  return metadata.owner.toString();
}

async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export function capsuleBlobName(params: { recipient: string; id: string }): string {
  return `${CAPSULE_PREFIX}/to/${addressSlug(params.recipient)}/${params.id}.capsule.json`;
}

export function encodeCapsuleEnvelope(manifest: CapsuleManifest, encrypted: EncryptedPayload): Uint8Array {
  const envelope: CapsuleEnvelope = {
    version: 2,
    manifest: {
      ...manifest,
      storage: "shelby",
      status: manifest.status,
    },
    ciphertext: bytesToBase64(encrypted.ciphertext),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function decodeCapsuleEnvelope(bytes: Uint8Array): { manifest: CapsuleManifest; ciphertext: Uint8Array } {
  const envelope = JSON.parse(new TextDecoder().decode(bytes)) as CapsuleEnvelope;
  if (envelope.version !== 2 || !envelope.manifest || !envelope.ciphertext) {
    throw new Error("Unsupported Yora capsule envelope.");
  }
  return {
    manifest: {
      ...envelope.manifest,
      storage: "shelby",
      blobUrl: envelope.manifest.blobUrl,
    },
    ciphertext: base64ToBytes(envelope.ciphertext),
  };
}

export async function downloadCapsuleEnvelope(
  client: ShelbyClient,
  metadata: BlobMetadata,
  network: ShelbyNetworkId,
): Promise<CapsuleManifest | null> {
  const owner = metadataOwner(metadata);
  const blobUrl = shelbyBlobUrl(owner, metadata.blobNameSuffix, network);

  try {
    const blob = await client.rpc.getBlob({
      account: owner,
      blobName: metadata.blobNameSuffix,
    });
    const { manifest } = decodeCapsuleEnvelope(await streamToBytes(blob.readable));
    return {
      ...manifest,
      creator: owner,
      blobName: metadata.blobNameSuffix,
      blobUrl,
      storage: "shelby",
      shelbyNetwork: network,
    };
  } catch (rpcError) {
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) throw new Error(`Yora could not read the Shelby blob. Status ${response.status}.`);
      const { manifest } = decodeCapsuleEnvelope(new Uint8Array(await response.arrayBuffer()));
      return {
        ...manifest,
        creator: owner,
        blobName: metadata.blobNameSuffix,
        blobUrl,
        storage: "shelby",
        shelbyNetwork: network,
      };
    } catch {
      console.warn("Yora could not decode Shelby capsule envelope", {
        owner,
        blobName: metadata.blobNameSuffix,
        rpcError,
      });
      return null;
    }
  }
}

export async function discoverShelbyCapsules(params: {
  client: ShelbyClient;
  account: string;
  network: ShelbyNetworkId;
}): Promise<CapsuleManifest[]> {
  if (!params.account) return [];
  const recipientPattern = `%${CAPSULE_PREFIX}/to/${addressSlug(params.account)}/%`;
  const yoraPattern = `%${CAPSULE_PREFIX}/%`;

  const [sentMetadata, receivedMetadata] = await Promise.all([
    params.client.coordination.getAccountBlobs({
      account: params.account,
      pagination: { limit: 100 },
      where: {
        blob_name: { _ilike: yoraPattern },
      },
    }),
    params.client.coordination.getBlobs({
      pagination: { limit: 100 },
      where: {
        blob_name: { _ilike: recipientPattern },
      },
    }),
  ]);

  const deduped = new Map<string, BlobMetadata>();
  [...sentMetadata, ...receivedMetadata].forEach((metadata) => {
    deduped.set(`${metadataOwner(metadata)}:${metadata.blobNameSuffix}`, metadata);
  });

  const manifests = await Promise.all(
    [...deduped.values()].map((metadata) => downloadCapsuleEnvelope(params.client, metadata, params.network)),
  );

  return manifests
    .filter((manifest): manifest is CapsuleManifest => Boolean(manifest))
    .filter((manifest) => manifest.shelbyNetwork === params.network)
    .filter(
      (manifest) =>
        sameAddress(manifest.creator, params.account) ||
        sameAddress(manifest.recipient, params.account),
    )
    .sort((left, right) => right.createdAt - left.createdAt);
}
