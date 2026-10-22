//! Real OS credential-store roundtrip.
//!
//! Ignored by default because it writes a throwaway entry to the user's real
//! Keychain / Credential Manager / Secret Service. Run it explicitly on each
//! target before marking the platform credential backend as verified:
//!
//! ```text
//! cargo test --test keyring_roundtrip -- --ignored
//! ```
//!
//! A new `KeyringStore` instance is used for the read-back, so an in-memory
//! mock fallback cannot pass this test.

use vesrio_lib::provider::secrets::{KeyringStore, SecretStore};

#[test]
#[ignore = "writes a throwaway credential to the real OS credential store"]
fn keyring_roundtrip_uses_the_real_backend() {
    let service = format!("com.vesrio.app.test.{}", uuid::Uuid::new_v4());
    let account = "roundtrip";
    let store = KeyringStore::with_service(&service, account);

    assert!(
        store.backend() != "memory-test" && store.backend() != "unsupported",
        "no native credential backend is active: {}",
        store.backend()
    );

    let result = (|| -> Result<(), String> {
        if store.get().map_err(|e| e.to_string())?.is_some() {
            return Err("a throwaway service unexpectedly already has a value".into());
        }
        store.set("test-secret").map_err(|e| e.to_string())?;

        // A separate entry instance proves persistence inside the backend,
        // not just state held by the first KeyringStore.
        let reopened = KeyringStore::with_service(&service, account);
        let stored = reopened.get().map_err(|e| e.to_string())?;
        if stored.as_deref() != Some("test-secret") {
            return Err(format!("unexpected stored value: {stored:?}"));
        }
        Ok(())
    })();

    let cleanup = store.delete().map_err(|e| e.to_string());
    result.expect("credential roundtrip failed");
    cleanup.expect("credential cleanup failed");
}
