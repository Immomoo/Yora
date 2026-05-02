# Phase 4: Production Key Release

Yora already writes encrypted capsule blobs to Shelby. The remaining production gap is key release: the AES decrypt key must not depend on browser localStorage.

## Recommended Direction

Build a key-release service that stores capsule keys server-side and releases them only after validation.

## MVP Scope

- Add `VITE_YORA_KEY_RELEASE_URL` to the frontend.
- During seal, upload encrypted capsule data to Shelby first.
- After Shelby confirms the blob write, escrow the AES key to the key-release service.
- During unseal, require the connected recipient wallet to sign a release request.
- The service verifies recipient address, unlock timestamp, capsule digest, blob pointer, and selected Shelby route.
- If valid, the service returns the AES key so the browser can decrypt the Shelby blob locally.

## Production-Harder Scope

- Add an Aptos Move registry for capsule metadata, recipient, unlock timestamp, blob pointer, and digest.
- Make the key-release service verify registry state before releasing keys.
- Later, replace the centralized release service with threshold or decentralized key management if the Shelby ecosystem supports that path.

## Non-Goals

- Do not store plaintext decrypt keys in Shelby.
- Do not treat localStorage key vault as production-safe.
- Do not mark unseal as fully decentralized until the key-release path is contract-backed or threshold-backed.
