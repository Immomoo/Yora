# Yora

Yora is a time-locked encrypted capsule dApp for Aptos and Shelby.

Users can seal private messages or files, encrypt them locally in the browser, write encrypted capsule blobs to Shelby, and let the recipient wallet unseal them after the selected unlock time.

## Features

- Local AES-GCM encryption before storage
- Shelby encrypted blob writes
- Shelbynet and Shelby Testnet route toggle
- Aptos wallet connection through the wallet adapter
- Recipient-based capsule discovery
- Sent and received capsule views
- Shelby explorer links for outgoing writes
- Clean, responsive Web3 interface

## Network Support

Yora supports:

- Shelbynet Devnet
- Shelby Testnet

Each route uses its own Shelby API key and blob endpoint through environment variables.

## Environment Variables

Copy `.env.example` to `.env` for local development.

```bash
VITE_YORA_NETWORK=testnet
VITE_APTOS_API_KEY=
VITE_SHELBYNET_APTOS_API_KEY=
VITE_SHELBY_API_KEY=
VITE_SHELBYNET_API_KEY=
VITE_SHELBY_TESTNET_API_KEY=
```

Never commit `.env` or real API keys. The project `.gitignore` keeps local environment files out of Git.

## Development

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Production Build

```bash
npm run build
```

The compiled app is generated in `dist/`.

## Security Notes

- Yora writes encrypted payloads to Shelby, not plaintext content.
- If Shelby rejects a blob write, the capsule is not created.
- API keys must be supplied through deployment environment variables.
- The current key-release path is documented in `docs/PHASE_4_KEY_RELEASE.md` for the next production hardening phase.

## Tech Stack

- React
- TypeScript
- Vite
- Aptos Wallet Adapter
- Shelby Protocol SDK
