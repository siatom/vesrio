//! OS credential storage. API keys never enter SQLite, JSON files or logs.
//!
//! Each supported platform must enable its native keyring backend in
//! `Cargo.toml`. Without a backend, keyring silently falls back to an
//! in-memory mock that cannot persist anything; [`backend_name`] makes the
//! active backend observable so the settings UI and release checks can treat
//! `unsupported` as a failure instead of claiming the key was saved.

use crate::error::{AppError, AppResult};

pub trait SecretStore: Send + Sync {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, secret: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;

    /// Stable identifier for the active backend, shown in the settings UI.
    fn backend(&self) -> &'static str {
        "unknown"
    }
}

/// Native credential store selected at compile time.
pub fn backend_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-credential-manager"
    } else if cfg!(target_os = "macos") {
        "macos-keychain"
    } else if cfg!(target_os = "linux") {
        "linux-secret-service"
    } else {
        "unsupported"
    }
}

fn credential_error(action: &str, error: impl std::fmt::Display) -> AppError {
    let hint = if cfg!(target_os = "linux") {
        " Ensure a D-Bus session and a Secret Service provider (GNOME Keyring or KWallet) are running."
    } else if cfg!(target_os = "macos") {
        " Ensure Keychain access is allowed for Vesrio."
    } else {
        ""
    };
    AppError::storage(format!(
        "could not {action} the API key with {}{hint} (details: {error})",
        backend_name()
    ))
}

pub struct KeyringStore {
    service: String,
    account: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        // Desktop E2E builds use a throwaway credential entry so tests never
        // read or overwrite the user's real API key. Release builds always use
        // the fixed production service name.
        let service = if cfg!(debug_assertions) {
            std::env::var("VESRIO_SECRET_SERVICE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "com.vesrio.app".into())
        } else {
            "com.vesrio.app".into()
        };
        Self::with_service(service, "provider-default")
    }
}

impl KeyringStore {
    /// Construct a store for a specific service/account pair. Tests use this
    /// with a throwaway service name so they never touch the real API key.
    pub fn with_service(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account).map_err(|e| credential_error("access", e))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self) -> AppResult<Option<String>> {
        match self.entry()?.get_password() {
            Ok(value) if !value.is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(credential_error("read", error)),
        }
    }

    fn set(&self, secret: &str) -> AppResult<()> {
        if secret.trim().is_empty() {
            return Err(AppError::invalid("API key must not be empty"));
        }
        self.entry()?
            .set_password(secret.trim())
            .map_err(|e| credential_error("store", e))
    }

    fn delete(&self) -> AppResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(credential_error("delete", error)),
        }
    }

    fn backend(&self) -> &'static str {
        backend_name()
    }
}

#[cfg(test)]
pub struct MemoryStore(pub std::sync::Mutex<Option<String>>);

#[cfg(test)]
impl Default for MemoryStore {
    fn default() -> Self {
        Self(std::sync::Mutex::new(None))
    }
}

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self) -> AppResult<Option<String>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set(&self, secret: &str) -> AppResult<()> {
        *self.0.lock().unwrap() = Some(secret.to_string());
        Ok(())
    }
    fn delete(&self) -> AppResult<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
    fn backend(&self) -> &'static str {
        "memory-test"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_name_matches_the_target() {
        let expected = if cfg!(target_os = "windows") {
            "windows-credential-manager"
        } else if cfg!(target_os = "macos") {
            "macos-keychain"
        } else if cfg!(target_os = "linux") {
            "linux-secret-service"
        } else {
            "unsupported"
        };
        assert_eq!(backend_name(), expected);
    }

    #[test]
    fn memory_store_round_trip_never_touches_the_os_store() {
        let store = MemoryStore::default();
        assert_eq!(store.get().unwrap(), None);
        store.set("test-key").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("test-key"));
        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);
        assert_eq!(store.backend(), "memory-test");
    }
}
