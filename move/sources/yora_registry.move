module yora::yora_registry {
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};
    use std::signer;

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_CAPSULE_EXISTS: u64 = 3;
    const E_CAPSULE_MISSING: u64 = 4;
    const E_NOT_RECIPIENT: u64 = 5;

    struct Registry has key {
        capsules: Table<vector<u8>, Capsule>,
    }

    struct Capsule has copy, drop, store {
        creator: address,
        recipient: address,
        unlock_at_secs: u64,
        shelby_network: vector<u8>,
        blob_owner: address,
        blob_name: vector<u8>,
        ciphertext_digest: vector<u8>,
        payload_kind: vector<u8>,
        size_bytes: u64,
        created_at_secs: u64,
        released: bool,
        released_at_secs: u64,
    }

    #[event]
    struct RegistryInitialized has drop, store {
        registry_owner: address,
    }

    #[event]
    struct CapsuleRegistered has drop, store {
        registry_owner: address,
        capsule_id: vector<u8>,
        creator: address,
        recipient: address,
        unlock_at_secs: u64,
        shelby_network: vector<u8>,
        blob_owner: address,
        blob_name: vector<u8>,
        ciphertext_digest: vector<u8>,
    }

    #[event]
    struct CapsuleReleased has drop, store {
        registry_owner: address,
        capsule_id: vector<u8>,
        recipient: address,
        released_at_secs: u64,
    }

    public entry fun initialize(owner: &signer) {
        let owner_address = signer::address_of(owner);
        assert!(!exists<Registry>(owner_address), E_ALREADY_INITIALIZED);
        move_to(owner, Registry { capsules: table::new<vector<u8>, Capsule>() });
        event::emit(RegistryInitialized { registry_owner: owner_address });
    }

    public entry fun register_capsule(
        creator: &signer,
        registry_owner: address,
        capsule_id: vector<u8>,
        recipient: address,
        unlock_at_secs: u64,
        shelby_network: vector<u8>,
        blob_owner: address,
        blob_name: vector<u8>,
        ciphertext_digest: vector<u8>,
        payload_kind: vector<u8>,
        size_bytes: u64,
    ) acquires Registry {
        assert!(exists<Registry>(registry_owner), E_NOT_INITIALIZED);
        let registry = borrow_global_mut<Registry>(registry_owner);
        assert!(!table::contains(&registry.capsules, copy capsule_id), E_CAPSULE_EXISTS);

        let creator_address = signer::address_of(creator);
        let created_at_secs = timestamp::now_seconds();
        table::add(
            &mut registry.capsules,
            copy capsule_id,
            Capsule {
                creator: creator_address,
                recipient,
                unlock_at_secs,
                shelby_network: copy shelby_network,
                blob_owner,
                blob_name: copy blob_name,
                ciphertext_digest: copy ciphertext_digest,
                payload_kind,
                size_bytes,
                created_at_secs,
                released: false,
                released_at_secs: 0,
            },
        );

        event::emit(CapsuleRegistered {
            registry_owner,
            capsule_id,
            creator: creator_address,
            recipient,
            unlock_at_secs,
            shelby_network,
            blob_owner,
            blob_name,
            ciphertext_digest,
        });
    }

    public entry fun mark_released(
        recipient_signer: &signer,
        registry_owner: address,
        capsule_id: vector<u8>,
    ) acquires Registry {
        assert!(exists<Registry>(registry_owner), E_NOT_INITIALIZED);
        let registry = borrow_global_mut<Registry>(registry_owner);
        assert!(table::contains(&registry.capsules, copy capsule_id), E_CAPSULE_MISSING);

        let capsule = table::borrow_mut(&mut registry.capsules, copy capsule_id);
        let recipient = signer::address_of(recipient_signer);
        assert!(capsule.recipient == recipient, E_NOT_RECIPIENT);

        let released_at_secs = timestamp::now_seconds();
        capsule.released = true;
        capsule.released_at_secs = released_at_secs;

        event::emit(CapsuleReleased {
            registry_owner,
            capsule_id,
            recipient,
            released_at_secs,
        });
    }

    #[view]
    public fun has_capsule(registry_owner: address, capsule_id: vector<u8>): bool acquires Registry {
        if (!exists<Registry>(registry_owner)) {
            false
        } else {
            let registry = borrow_global<Registry>(registry_owner);
            table::contains(&registry.capsules, capsule_id)
        }
    }

    #[view]
    public fun get_capsule(registry_owner: address, capsule_id: vector<u8>): Capsule acquires Registry {
        assert!(exists<Registry>(registry_owner), E_NOT_INITIALIZED);
        let registry = borrow_global<Registry>(registry_owner);
        assert!(table::contains(&registry.capsules, copy capsule_id), E_CAPSULE_MISSING);
        *table::borrow(&registry.capsules, capsule_id)
    }
}
