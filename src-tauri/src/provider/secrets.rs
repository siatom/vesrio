//! OS credential storage. API keys never enter SQLite, JSON files or logs.

use crate::error::{AppError, AppResult};

pub trait SecretStore: Send + Sync {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, secret: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

pub struct KeyringStore {
    service: String,
    account: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self {
            service: "com.vesrio.app".into(),
            account: "provider-default".into(),
        }
    }
}

impl KeyringStore {
    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| AppError::storage(format!("credential store unavailable: {e}")))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self) -> AppResult<Option<String>> {
        match self.entry()?.get_password() {
            Ok(value) if !value.is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::storage(format!(
                "could not read API key from credential store: {error}"
            ))),
        }
    }

    fn set(&self, secret: &str) -> AppResult<()> {
        if secret.trim().is_empty() {
            return Err(AppError::invalid("API key must not be empty"));
        }
        self.entry()?
            .set_password(secret.trim())
            .map_err(|e| AppError::storage(format!("could not store API key: {e}")))
    }

    fn delete(&self) -> AppResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::storage(format!(
                "could not delete API key: {error}"
            ))),
        }
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
}
