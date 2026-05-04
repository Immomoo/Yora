# Yora Aptos Registry

This package contains the optional Aptos Move registry for Yora capsule metadata.

The registry records:

- capsule id
- creator
- recipient
- unlock timestamp
- Shelby route
- Shelby blob owner and blob name
- ciphertext digest
- payload type and size
- release marker

The encrypted payload remains on Shelby. The Move registry stores metadata only.

## Compile

```bash
npm run move:compile -- --named-addresses yora=<publisher-address>
```

## Publish

```bash
npm run move:publish -- --named-addresses yora=<publisher-address>
```

After publishing, initialize the registry once:

```bash
aptos move run \
  --function-id <publisher-address>::yora_registry::initialize
```

Then set the frontend env variable:

```bash
VITE_YORA_REGISTRY_ADDRESS=<publisher-address>
```
