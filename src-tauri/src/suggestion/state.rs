//! Suggestion lifecycle. Every persisted status change goes through
//! `assert_transition`, so an invalid state cannot be introduced by a race,
//! a retried command or a stale UI.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionStatus {
    Created,
    Generating,
    Ready,
    Stale,
    Accepted,
    Rejected,
    Failed,
    Canceled,
}

impl SuggestionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Generating => "generating",
            Self::Ready => "ready",
            Self::Stale => "stale",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "created" => Ok(Self::Created),
            "generating" => Ok(Self::Generating),
            "ready" => Ok(Self::Ready),
            "stale" => Ok(Self::Stale),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            other => Err(AppError::internal(format!(
                "unknown suggestion status: {other}"
            ))),
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Accepted | Self::Rejected | Self::Failed | Self::Canceled
        )
    }

    pub fn can_transition(self, next: Self) -> bool {
        if self == next {
            // Idempotent terminal updates are allowed for retried commands.
            return true;
        }
        match self {
            Self::Created => matches!(next, Self::Generating | Self::Canceled | Self::Failed),
            Self::Generating => matches!(
                next,
                Self::Ready | Self::Stale | Self::Failed | Self::Canceled
            ),
            Self::Ready => matches!(next, Self::Accepted | Self::Rejected | Self::Stale),
            Self::Stale => matches!(next, Self::Rejected | Self::Canceled),
            Self::Accepted | Self::Rejected | Self::Failed | Self::Canceled => false,
        }
    }

    pub fn assert_transition(self, next: Self) -> AppResult<()> {
        if self.can_transition(next) {
            Ok(())
        } else {
            Err(AppError::InvalidTransition {
                from: self.as_str().to_string(),
                to: next.as_str().to_string(),
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    Prepared,
    Generating,
    Completed,
    Failed,
    Canceled,
}

impl RequestStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Prepared => "prepared",
            Self::Generating => "generating",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "prepared" => Ok(Self::Prepared),
            "generating" => Ok(Self::Generating),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "canceled" => Ok(Self::Canceled),
            other => Err(AppError::internal(format!(
                "unknown request status: {other}"
            ))),
        }
    }

    pub fn can_transition(self, next: Self) -> bool {
        if self == next {
            return true;
        }
        match self {
            Self::Prepared => matches!(next, Self::Generating | Self::Failed | Self::Canceled),
            Self::Generating => matches!(next, Self::Completed | Self::Failed | Self::Canceled),
            Self::Completed | Self::Failed | Self::Canceled => false,
        }
    }

    pub fn assert_transition(self, next: Self) -> AppResult<()> {
        if self.can_transition(next) {
            Ok(())
        } else {
            Err(AppError::InvalidTransition {
                from: self.as_str().to_string(),
                to: next.as_str().to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_is_allowed() {
        let path = [
            SuggestionStatus::Created,
            SuggestionStatus::Generating,
            SuggestionStatus::Ready,
            SuggestionStatus::Accepted,
        ];
        for pair in path.windows(2) {
            assert!(pair[0].can_transition(pair[1]));
        }
    }

    #[test]
    fn stale_patch_cannot_be_accepted() {
        let err = SuggestionStatus::Stale
            .assert_transition(SuggestionStatus::Accepted)
            .unwrap_err();
        assert_eq!(err.code(), "invalid_transition");
    }

    #[test]
    fn accepted_is_terminal() {
        for next in [
            SuggestionStatus::Rejected,
            SuggestionStatus::Ready,
            SuggestionStatus::Generating,
        ] {
            assert!(!SuggestionStatus::Accepted.can_transition(next));
        }
    }

    #[test]
    fn repeated_same_status_is_idempotent() {
        assert!(SuggestionStatus::Accepted.can_transition(SuggestionStatus::Accepted));
        assert!(RequestStatus::Canceled.can_transition(RequestStatus::Canceled));
    }

    #[test]
    fn request_cannot_skip_generation() {
        assert!(!RequestStatus::Prepared.can_transition(RequestStatus::Completed));
        assert!(RequestStatus::Prepared.can_transition(RequestStatus::Generating));
    }
}
