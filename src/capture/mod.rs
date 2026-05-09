// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

//! Capture module — handles `capture/{idea, journal, person}` WebSocket messages
//! by shelling out to `claude -p` for enrichment, then writing the resulting
//! markdown to the configured Carnet sync folder.

pub mod claude;
pub mod handlers;

/// Response payload returned by every capture handler. Serialised on the wire
/// as part of the `capture_response` envelope (see `ws.rs`).
#[derive(Debug, Clone)]
pub struct CaptureResponse {
    pub filepath: String,
    pub preview_markdown: String,
}
