# Yora Security Notes

This document explains Yora's current security model, trust assumptions, known limitations, and responsible disclosure process.

Yora is an experimental time-locked encrypted capsule dApp. It has been manually tested end-to-end on Shelbynet, but it should still be treated as pre-mainnet software until the key-release and registry flows receive broader review.

## Scope

This document covers:

- browser-side encryption and decryption,
- Shelby encrypted blob storage,
- remote key escrow and release,
- Aptos wallet authorization,
- optional Aptos Move registry metadata,
- public metadata exposure,
- known production hardening gaps.

It does not claim that Yora is fully decentralized or formally audited.

## Supported Routes

| Route | Status | Notes |
| --- | --- | --- |
| Shelbynet Devnet | Manually tested | Create, Shelby write, recipient discovery, unseal, file preview, cross-browser unseal, and registry UI have been tested. |
| Shelby Testnet | Implemented, pending validation | The route is available in the dApp, but full end-to-end validation depends on Early Access availability. |

## Security Goals

Yora is designed to provide these guarantees:

- Plaintext payloads should not be written to Shelby.
- Capsule payloads should be encrypted in the browser before storage.
- A capsule should be discoverable by the recipient wallet through Shelby metadata and indexing.
- Only the recipient wallet should be able to request the release key.
- The release key should only be returned after the unlock timestamp.
- If Shelby rejects an encrypted blob write, Yora should not create a local capsule as if the write succeeded.
- Registry records, when configured, should act as public receipts for capsule metadata and release markers.

## Current Trust Boundary

### Browser

The browser is responsible for:

- collecting the capsule payload,
- encrypting message or file bytes with Web Crypto AES-GCM,
- building the encrypted Yora capsule envelope,
- submitting the encrypted blob to Shelby,
- requesting wallet signatures,
- decrypting the payload after a valid key release.

Plaintext payload bytes are expected to exist only in the browser session during compose and unseal.

### Shelby

Shelby stores encrypted capsule envelopes. Shelby is not expected to know the plaintext message or file bytes.

Shelby-visible data can include:

- blob owner,
- blob name,
- selected Shelby route,
- capsule envelope metadata,
- encrypted ciphertext,
- ciphertext digest,
- payload kind,
- payload size,
- creator and recipient addresses when included in the capsule envelope.

### Key-Release API

Yora includes Vercel API routes for remote key release:

```text
POST /api/v1/capsules/escrow
POST /api/v1/capsules/release
```

The API stores encrypted key records in KV-style REST storage. During unseal, it validates:

- capsule id,
- key id,
- recipient address,
- Shelby route,
- blob owner,
- blob name,
- ciphertext digest,
- unlock timestamp,
- wallet-signed release message.

The API returns the decrypt key only after validation. It does not return plaintext payloads.

### Aptos Wallet

The wallet is used for:

- account identity,
- route/network confirmation,
- creator escrow approval,
- recipient release approval,
- optional registry transactions.

Yora relies on wallet signatures to bind key escrow and key release requests to the expected Aptos account.

### Optional Aptos Move Registry

The Move registry records metadata only:

- capsule id,
- creator,
- recipient,
- unlock timestamp,
- Shelby route,
- blob owner,
- blob name,
- ciphertext digest,
- payload kind and size,
- release marker.

The registry does not store plaintext payloads or decrypt keys.

## What Is Encrypted

Encrypted:

- message body,
- file bytes,
- image bytes,
- any payload content selected by the sender.

Not encrypted by the payload key:

- creator address,
- recipient address,
- unlock timestamp,
- payload kind,
- payload size,
- Shelby blob owner,
- Shelby blob name,
- ciphertext digest,
- registry transaction hashes.

Users should assume capsule metadata is public or discoverable.

## Key Management

Yora currently supports two key-release modes.

### Remote Key Release

When `VITE_YORA_KEY_RELEASE_URL` and `VITE_YORA_KEY_RELEASE_PUBLIC_KEY` are configured:

- the browser encrypts the capsule decrypt key to the key-release service public key,
- the server stores the encrypted key record,
- the recipient signs a release request after unlock time,
- the server validates the request and returns the decrypt key,
- the browser decrypts the Shelby payload locally.

This mode supports cross-browser and cross-device unseal, assuming the same recipient wallet can sign the release request.

### Browser-Only Fallback

When remote key release is not configured, Yora can use a browser-local key vault for development.

This fallback is not production-safe because keys are tied to the browser session that sealed the capsule. It should not be used as a production guarantee.

## Known Limitations

- The key-release service is centralized and service-backed.
- Release decisions are not yet fully enforced by an on-chain or threshold key management system.
- Registry-backed release verification is a hardening target, not a complete guarantee today.
- Shelby Testnet has not been fully validated end-to-end until Early Access is available.
- The app has manual Shelbynet validation, but automated E2E tests are still pending.
- Frontend `VITE_` variables are exposed in the browser bundle by design. Do not place private secrets in `VITE_` variables.
- If Shelby API keys must be private, Shelby writes should move behind a backend/proxy for mainnet-grade deployment.
- Yora has not received an independent security audit.

## Operational Recommendations

Before broader public use:

- keep all server-only variables outside the frontend bundle,
- rotate the RSA key-release keypair on an operational schedule,
- protect KV credentials in Vercel project settings,
- enable production logging for key escrow and release failures,
- add replay protection beyond timestamp freshness if usage grows,
- connect release validation to registry state,
- add automated tests for create, discover, unseal, and preview flows,
- commission an external review before handling sensitive production payloads.

## Environment Safety

Never commit:

- `.env`,
- Shelby API keys,
- Aptos API keys,
- `YORA_KEY_RELEASE_PRIVATE_KEY`,
- KV REST tokens,
- private wallet keys or seed phrases.

Expected server-only variables:

```text
YORA_KEY_RELEASE_PRIVATE_KEY
YORA_KV_REST_API_URL
YORA_KV_REST_API_TOKEN
```

Expected browser-exposed variables:

```text
VITE_YORA_NETWORK
VITE_APTOS_API_KEY
VITE_SHELBYNET_APTOS_API_KEY
VITE_SHELBY_API_KEY
VITE_SHELBYNET_API_KEY
VITE_SHELBY_TESTNET_API_KEY
VITE_YORA_KEY_RELEASE_URL
VITE_YORA_KEY_RELEASE_PUBLIC_KEY
VITE_YORA_REGISTRY_ADDRESS
VITE_YORA_SHELBYNET_REGISTRY_ADDRESS
VITE_YORA_TESTNET_REGISTRY_ADDRESS
```

Browser-exposed variables must be treated as public.

## Responsible Disclosure

If you find a security issue, please do not post exploit details publicly first.

Open a private GitHub security advisory if available, or contact the maintainer through the GitHub repository:

```text
https://github.com/Immomoo/Yora
```

Please include:

- affected route or component,
- steps to reproduce,
- expected impact,
- whether secrets, keys, payloads, or wallet approvals are involved,
- screenshots or logs if they do not expose private data.

## Security Status Summary

Yora currently provides strong browser-side payload encryption and a practical remote key-release flow for Shelbynet testing. The main remaining security work is production hardening: registry-backed release validation, automated regression tests, operational key rotation, monitoring, and external review.
