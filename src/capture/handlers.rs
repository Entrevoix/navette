// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

//! Capture mode handlers. Each handler:
//!   1. Substitutes user input into a prompt template.
//!   2. Calls `claude -p` to produce Obsidian-compatible markdown.
//!   3. Strips defensive code-fence wrapping if Claude added any.
//!   4. Writes the file to `<sync_folder>/<Subdir>/<slug>.md` per the rules
//!      in CLAUDE.md (Ideas/, Journal/YYYY-MM-DD.md append-on-existing,
//!      People/Firstname-Lastname.md).
//!   5. Returns a `CaptureResponse` carrying filepath + preview markdown.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Local;

use super::claude::run_claude;
use super::CaptureResponse;

const IDEA_PROMPT: &str = r#"You are a personal knowledge assistant. The user has captured a quick idea or
half-formed thought. Your job is to:
1. Give it a concise title (5 words max, slug-friendly)
2. Expand the thought slightly — 2-3 sentences, no fluff
3. Suggest 2-3 relevant tags

Respond ONLY with valid Obsidian markdown in this exact format:
---
created: {TODAY}
status: seedling
tags: [idea, seedling, {tag1}, {tag2}]
---
# {Title}

{Expanded thought}

Raw input: {INPUT}
"#;

const JOURNAL_PROMPT: &str = r#"You are a personal knowledge assistant processing a voice note into a journal
entry. Extract structure from the raw transcript:
1. Clean up the transcript — remove filler words, fix transcription errors
2. Extract any people mentioned (first name or full name)
3. Extract any ideas or action items
4. Write a 1-sentence summary

Respond ONLY with valid Obsidian markdown in this exact format:
---
date: {TODAY}
tags: [journal]
people: [{people as [[Name]] wikilinks, comma separated}]
ideas: []
---
# {Summary sentence}

## Notes
{Cleaned transcript as bullet points}

## Actions
{Any action items extracted, or "None"}

Raw transcript: {INPUT}
"#;

const PERSON_PROMPT: &str = r#"You are a personal knowledge assistant creating a contact note. You have OCR
output from a business card and optional context about the meeting.

Respond ONLY with valid Obsidian markdown in this exact format:
---
name: {Full Name}
company: {Company}
title: {Title}
email: {email or ""}
phone: {phone or ""}
linkedin: {linkedin or ""}
met: {TODAY}
where: {extracted from context or ""}
tags: [person, networking]
---
# {Full Name}

## About
{1-2 sentences about who this person is based on their title/company}

## Meeting notes
{Context provided, or "No context provided"}

## Follow-up
{Any action items from context, or "None identified"}

Business card OCR: {OCR_INPUT}
Context: {CONTEXT_INPUT}
"#;

/// Compute the response for a `capture/idea` request WITHOUT writing to disk.
/// Returns `(filepath, markdown, response)` so the caller can ack the client
/// first and only persist after the ack succeeds. See `persist_idea`.
pub async fn prepare_idea(
    text: &str,
    sync_folder: &str,
) -> Result<(PathBuf, String, CaptureResponse)> {
    let today = today_iso();
    let prompt = IDEA_PROMPT
        .replace("{TODAY}", &today)
        .replace("{INPUT}", text);

    let raw = run_claude(&prompt).await?;
    let markdown = strip_code_fences(&raw);

    let title = extract_h1(&markdown).unwrap_or_else(|| "untitled".to_string());
    let slug = slugify(&title);
    let final_slug = if slug.is_empty() {
        "untitled".into()
    } else {
        slug
    };

    let dir = Path::new(sync_folder).join("Ideas");
    ensure_dir(&dir)?;
    let mut filepath = dir.join(format!("{final_slug}.md"));
    let mut n: u32 = 2;
    while filepath.exists() && n < 100 {
        filepath = dir.join(format!("{final_slug}-{n}.md"));
        n += 1;
    }
    if filepath.exists() {
        anyhow::bail!("more than 99 ideas with slug {final_slug} — pick a more distinctive title");
    }

    let response = CaptureResponse {
        filepath: filepath.to_string_lossy().into_owned(),
        preview_markdown: markdown.clone(),
    };
    Ok((filepath, markdown, response))
}

/// Atomically write the prepared idea markdown to disk. Only call this AFTER
/// the client has ack'd the response — see `prepare_idea`.
///
/// **Failure visibility**: a failure here is reported only via `tracing` on
/// the daemon; the client has already received an OK ack. Acceptable trade
/// for the dup-free invariant. If client-side visibility is needed, the
/// caller must emit a follow-up event before returning.
pub fn persist_idea(filepath: &Path, markdown: &str) -> Result<()> {
    write_atomic(filepath, markdown)
}

/// Compute the response for a `capture/journal` request WITHOUT writing to
/// disk. The append-vs-overwrite merge with the day's existing file happens
/// here (it depends on a FS read, which is safe to do pre-ack). Returns
/// `(filepath, final_markdown, response)`.
pub async fn prepare_journal(
    transcript: &str,
    sync_folder: &str,
) -> Result<(PathBuf, String, CaptureResponse)> {
    let today = today_iso();
    let prompt = JOURNAL_PROMPT
        .replace("{TODAY}", &today)
        .replace("{INPUT}", transcript);

    let raw = run_claude(&prompt).await?;
    let markdown = strip_code_fences(&raw);

    let dir = Path::new(sync_folder).join("Journal");
    ensure_dir(&dir)?;
    let filepath = dir.join(format!("{today}.md"));

    let final_markdown = if filepath.exists() {
        let existing = std::fs::read_to_string(&filepath)
            .with_context(|| format!("failed to read existing {}", filepath.display()))?;
        let now = Local::now().format("%H:%M").to_string();
        append_journal_entry(&existing, &markdown, &now)
    } else {
        markdown
    };

    let response = CaptureResponse {
        filepath: filepath.to_string_lossy().into_owned(),
        preview_markdown: final_markdown.clone(),
    };
    Ok((filepath, final_markdown, response))
}

/// Atomically write the merged journal markdown. Only call AFTER ack.
///
/// **Failure visibility**: see [`persist_idea`] — trace-only, client already ack'd.
pub fn persist_journal(filepath: &Path, final_markdown: &str) -> Result<()> {
    write_atomic(filepath, final_markdown)
}

/// Rewrite the `status:` frontmatter field on an existing idea note. The body
/// (everything past the closing `---`) is left byte-identical. Returns the
/// new full file contents as the `preview_markdown` so the client can refresh
/// without re-reading.
pub async fn promote_idea(filepath: &str, status: &str) -> Result<CaptureResponse> {
    if !["seedling", "developing", "mature"].contains(&status) {
        anyhow::bail!("invalid status: {status} (expected seedling|developing|mature)");
    }
    let content =
        std::fs::read_to_string(filepath).with_context(|| format!("failed to read {filepath}"))?;
    let updated = rewrite_frontmatter_field(&content, "status", status)?;
    write_atomic(Path::new(filepath), &updated)?;
    Ok(CaptureResponse {
        filepath: filepath.to_string(),
        preview_markdown: updated,
    })
}

/// Compute the response for a `capture/person` request WITHOUT writing to
/// disk. Returns `(filepath, markdown, response)`.
pub async fn prepare_person(
    ocr_result: &str,
    context: &str,
    sync_folder: &str,
) -> Result<(PathBuf, String, CaptureResponse)> {
    let today = today_iso();
    let prompt = PERSON_PROMPT
        .replace("{TODAY}", &today)
        .replace("{OCR_INPUT}", ocr_result)
        .replace("{CONTEXT_INPUT}", context);

    let raw = run_claude(&prompt).await?;
    let markdown = strip_code_fences(&raw);

    let name = extract_frontmatter_field(&markdown, "name")
        .or_else(|| extract_h1(&markdown))
        .unwrap_or_else(|| "Unknown Person".to_string());
    let filename = person_filename(&name);
    let final_filename = if filename.is_empty() {
        "Unknown-Person".into()
    } else {
        filename
    };

    let dir = Path::new(sync_folder).join("People");
    ensure_dir(&dir)?;
    let filepath = dir.join(format!("{final_filename}.md"));

    let response = CaptureResponse {
        filepath: filepath.to_string_lossy().into_owned(),
        preview_markdown: markdown.clone(),
    };
    Ok((filepath, markdown, response))
}

/// Atomically write the prepared person markdown. Only call AFTER ack.
///
/// **Failure visibility**: see [`persist_idea`] — trace-only, client already ack'd.
pub fn persist_person(filepath: &Path, markdown: &str) -> Result<()> {
    write_atomic(filepath, markdown)
}

fn today_iso() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn ensure_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))
}

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("md.tmp");
    {
        let mut f = std::fs::File::create(&tmp)
            .with_context(|| format!("failed to open tmp {}", tmp.display()))?;
        f.write_all(content.as_bytes())
            .with_context(|| format!("failed to write tmp {}", tmp.display()))?;
        f.sync_all().context("failed to fsync capture file")?;
    }
    std::fs::rename(&tmp, path)
        .with_context(|| format!("failed to rename {} → {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Strip a leading triple-backtick fence (and matching trailer) if Claude
/// wrapped the entire response. Tolerant of optional language tags like
/// ```markdown.
fn strip_code_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Drop the optional language tag on the first line, then the trailing
        // fence if present.
        let after_lang = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        if let Some(stripped) = after_lang.strip_suffix("```") {
            return stripped.trim_end().to_string();
        }
        return after_lang.to_string();
    }
    trimmed.to_string()
}

fn strip_frontmatter(markdown: &str) -> String {
    let s = markdown.trim_start();
    if !s.starts_with("---") {
        return markdown.to_string();
    }
    // Skip the opening ---, find the closing --- on its own line.
    let after_first = &s[3..];
    if let Some(end) = after_first.find("\n---") {
        let rest = &after_first[end + 4..];
        return rest.trim_start_matches('\n').to_string();
    }
    markdown.to_string()
}

fn extract_h1(markdown: &str) -> Option<String> {
    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

fn extract_frontmatter_field(markdown: &str, field: &str) -> Option<String> {
    let s = markdown.trim_start();
    if !s.starts_with("---") {
        return None;
    }
    let after_first = &s[3..];
    let end = after_first.find("\n---")?;
    let block = &after_first[..end];
    let prefix = format!("{field}:");
    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Lowercase + ASCII-only + hyphen-separated. Transliterates Unicode via
/// `deunicode` first ("Mémoire" → "Memoire") so non-Latin titles produce
/// readable slugs instead of empty strings.
fn slugify(input: &str) -> String {
    let folded = deunicode::deunicode(input);
    let mut out = String::with_capacity(folded.len());
    let mut prev_dash = true;
    for c in folded.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Rewrite a single field in the YAML frontmatter block. Returns an error if
/// the file lacks frontmatter, the named field is absent, or the new value
/// contains characters that would break YAML structure.
///
/// The closing `---` fence is matched as a line whose trimmed content equals
/// `---`, NOT via raw substring search. The naive `find("\n---")` approach
/// mis-cuts on body-level horizontal rules or any literal `\n---` later in
/// the file.
fn rewrite_frontmatter_field(content: &str, field: &str, new_value: &str) -> Result<String> {
    if new_value.contains('\n') || new_value.contains('\r') {
        anyhow::bail!("frontmatter values cannot contain newlines or carriage returns");
    }

    let s = content.trim_start();
    if !s.starts_with("---") {
        anyhow::bail!("file has no YAML frontmatter");
    }
    let after_first = &s[3..];

    // Find the closing `---` fence by scanning for a line whose trimmed
    // contents equal `---`. Track byte offsets so we can split cleanly.
    let mut block_end: Option<usize> = None;
    let mut offset: usize = 0;
    for line in after_first.split_inclusive('\n') {
        let line_no_terminator = line.strip_suffix('\n').unwrap_or(line);
        if line_no_terminator.trim() == "---" {
            block_end = Some(offset);
            break;
        }
        offset += line.len();
    }
    let block_end = block_end.context("unterminated frontmatter block")?;
    let block = &after_first[..block_end];
    let body = &after_first[block_end..];

    let prefix = format!("{field}:");
    let mut found = false;
    let mut new_block = String::with_capacity(block.len());
    for line in block.split_inclusive('\n') {
        if !found && line.trim_start().starts_with(&prefix) {
            let leading_ws_len = line.len() - line.trim_start().len();
            new_block.push_str(&line[..leading_ws_len]);
            new_block.push_str(&prefix);
            new_block.push(' ');
            new_block.push_str(new_value);
            new_block.push('\n');
            found = true;
        } else {
            new_block.push_str(line);
        }
    }
    if !found {
        anyhow::bail!("field `{field}` not present in frontmatter");
    }
    Ok(format!("---{new_block}{body}"))
}

/// Pure helper for the journal append-on-existing branch: takes the existing
/// file contents + the freshly-generated markdown + the time of the new
/// entry, returns the merged file contents. Extracted out of `handle_journal`
/// so it can be unit-tested without mocking `run_claude`.
fn append_journal_entry(existing: &str, new_md: &str, time_hhmm: &str) -> String {
    let appended = strip_frontmatter(new_md);
    format!(
        "{}\n\n## {time_hhmm}\n\n{}",
        existing.trim_end(),
        appended.trim_start()
    )
}

/// `Firstname-Lastname` (preserving case in tokens, hyphenating spaces).
fn person_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || *c == '-' || *c == '\'')
        .collect();
    cleaned
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("My Big Idea"), "my-big-idea");
        assert_eq!(slugify("  weird   spacing!  "), "weird-spacing");
        // Emoji are transliterated by deunicode (🚀 → "rocket"), then folded.
        assert_eq!(slugify("emoji 🚀 in title"), "emoji-rocket-in-title");
    }

    #[test]
    fn slugify_collapses_punctuation() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
    }

    #[test]
    fn person_filename_basic() {
        assert_eq!(person_filename("Jane Doe"), "Jane-Doe");
        assert_eq!(person_filename("  Jean-Luc Picard  "), "Jean-Luc-Picard");
    }

    #[test]
    fn extract_h1_finds_first() {
        let md = "---\nx: 1\n---\n# Real Title\n\nbody\n";
        assert_eq!(extract_h1(md), Some("Real Title".into()));
    }

    #[test]
    fn extract_frontmatter_field_basic() {
        let md = "---\nname: Jane Doe\ncompany: Acme\n---\n# Jane Doe\n";
        assert_eq!(
            extract_frontmatter_field(md, "name"),
            Some("Jane Doe".into())
        );
        assert_eq!(
            extract_frontmatter_field(md, "company"),
            Some("Acme".into())
        );
        assert_eq!(extract_frontmatter_field(md, "missing"), None);
    }

    #[test]
    fn strip_code_fences_unwraps_markdown_block() {
        let raw = "```markdown\n# Title\n\nbody\n```";
        assert_eq!(strip_code_fences(raw), "# Title\n\nbody");
    }

    #[test]
    fn strip_code_fences_leaves_unfenced() {
        let raw = "# Title\n\nbody\n";
        assert_eq!(strip_code_fences(raw), "# Title\n\nbody");
    }

    #[test]
    fn strip_frontmatter_basic() {
        let md = "---\ndate: 2026-05-08\n---\n# Title\n\nbody";
        assert_eq!(strip_frontmatter(md), "# Title\n\nbody");
    }

    #[test]
    fn slugify_unicode_transliterates() {
        assert_eq!(slugify("Mémoire & flux"), "memoire-flux");
        assert_eq!(slugify("Café au lait"), "cafe-au-lait");
        assert_eq!(slugify("naïve résumé"), "naive-resume");
    }

    #[test]
    fn slugify_non_latin_yields_readable_slug() {
        // deunicode transliterates CJK to romaji/pinyin where possible.
        let slug = slugify("中文标题");
        // Don't assert exact output — deunicode versions vary — just verify
        // we got something non-empty and ASCII.
        assert!(
            !slug.is_empty(),
            "expected non-empty slug for Chinese input"
        );
        assert!(
            slug.chars().all(|c| c.is_ascii()),
            "slug must be ASCII: {slug:?}"
        );
    }

    #[test]
    fn rewrite_frontmatter_field_basic() {
        let md = "---\ncreated: 2026-05-08\nstatus: seedling\ntags: [idea]\n---\n# Title\n\nbody\n";
        let out = rewrite_frontmatter_field(md, "status", "developing").unwrap();
        assert!(out.contains("status: developing"));
        assert!(!out.contains("status: seedling"));
        // Body must be byte-identical.
        assert!(out.ends_with("# Title\n\nbody\n"));
        // Frontmatter sentinels still present and balanced.
        assert!(out.starts_with("---\n"));
        assert_eq!(out.matches("\n---").count(), 1);
    }

    #[test]
    fn rewrite_frontmatter_field_idempotent_on_same_value() {
        let md = "---\nstatus: developing\n---\n# Title\n";
        let out = rewrite_frontmatter_field(md, "status", "developing").unwrap();
        // Should still contain exactly one status line with the same value.
        assert_eq!(out.matches("status: developing").count(), 1);
    }

    #[test]
    fn rewrite_frontmatter_field_errors_on_missing_field() {
        let md = "---\ncreated: 2026-05-08\n---\n# Title\n";
        let err = rewrite_frontmatter_field(md, "status", "developing").unwrap_err();
        assert!(err.to_string().contains("not present"));
    }

    #[test]
    fn rewrite_frontmatter_field_errors_on_no_frontmatter() {
        let md = "# Just a title\n\nbody\n";
        let err = rewrite_frontmatter_field(md, "status", "developing").unwrap_err();
        assert!(err.to_string().contains("no YAML frontmatter"));
    }

    #[tokio::test]
    async fn promote_idea_rejects_invalid_status() {
        let tmp = std::env::temp_dir().join("carnet-promote-test-bad");
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(&tmp, "---\nstatus: seedling\n---\n# T\n").unwrap();
        let path = tmp.to_string_lossy().to_string();
        let err = promote_idea(&path, "neglected").await.unwrap_err();
        assert!(err.to_string().contains("invalid status"));
        let _ = std::fs::remove_file(&tmp);
    }

    #[tokio::test]
    async fn promote_idea_rewrites_status() {
        let tmp = std::env::temp_dir().join("carnet-promote-test-ok.md");
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(
            &tmp,
            "---\ncreated: 2026-05-08\nstatus: seedling\ntags: [idea]\n---\n# Test\n\nbody\n",
        )
        .unwrap();
        let path = tmp.to_string_lossy().to_string();
        let resp = promote_idea(&path, "developing").await.unwrap();
        let on_disk = std::fs::read_to_string(&tmp).unwrap();
        assert!(on_disk.contains("status: developing"));
        assert!(!on_disk.contains("status: seedling"));
        assert_eq!(resp.preview_markdown, on_disk);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn rewrite_frontmatter_preserves_body_with_horizontal_rules() {
        // Body contains its own `---` lines. The naive find("\n---") would
        // mis-cut here. The line-aware parser must NOT.
        let body =
            "# Title\n\nIntro.\n\n---\n\nA section after a horizontal rule.\n\n---\n\nAnother.\n";
        let md = format!("---\nstatus: seedling\n---\n{body}");
        let out = rewrite_frontmatter_field(&md, "status", "developing").unwrap();

        // Frontmatter changed.
        assert!(out.contains("status: developing"));
        assert!(!out.contains("status: seedling"));

        // Body byte-identical after the closing fence.
        let body_out = out
            .split("\n---\n")
            .nth(1)
            .expect("expected body after fence");
        assert!(
            body_out.starts_with("# Title"),
            "body got mis-cut: {body_out:?}"
        );
        // The full body content (including its own horizontal rules) must survive.
        assert!(out.ends_with(body));
    }

    #[test]
    fn rewrite_frontmatter_rejects_newlines_in_value() {
        let md = "---\nstatus: seedling\n---\n# T\n";
        let err =
            rewrite_frontmatter_field(md, "status", "developing\ninjected: payload").unwrap_err();
        assert!(err.to_string().contains("newlines"));
    }

    #[test]
    fn rewrite_frontmatter_rejects_carriage_returns_in_value() {
        let md = "---\nstatus: seedling\n---\n# T\n";
        let err = rewrite_frontmatter_field(md, "status", "developing\rfoo").unwrap_err();
        assert!(err.to_string().contains("carriage"));
    }

    #[test]
    fn append_journal_entry_uses_time_heading_and_preserves_first_entry() {
        let existing =
            "---\ndate: 2026-05-08\ntags: [journal]\n---\n# First entry\n\n## Notes\n- one\n";
        let new_md =
            "---\ndate: 2026-05-08\ntags: [journal]\n---\n# Second entry\n\n## Notes\n- two\n";
        let result = append_journal_entry(existing, new_md, "14:32");

        // Time heading present once, in the right place.
        assert!(result.contains("\n## 14:32\n"));

        // First entry's content survives intact.
        assert!(result.contains("# First entry"));
        assert!(result.contains("- one"));

        // New entry's body is appended (frontmatter stripped).
        assert!(result.contains("# Second entry"));
        assert!(result.contains("- two"));

        // No double frontmatter — exactly one opening `---\n` at start.
        assert!(result.starts_with("---\n"));
        // The second entry's frontmatter `tags: [journal]` should NOT appear
        // a second time (we keep one `tags: [journal]` line, not two).
        assert_eq!(result.matches("tags: [journal]").count(), 1);
    }

    #[test]
    fn persist_idea_writes_markdown_atomically() {
        let dir = std::env::temp_dir().join("carnet-persist-idea-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.md");
        let md = "---\ntags: [idea]\n---\n# Test\n\nbody\n";
        persist_idea(&path, md).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), md);
        // Atomic write should leave no .tmp residue.
        assert!(!path.with_extension("md.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_journal_writes_merged_markdown() {
        let dir = std::env::temp_dir().join("carnet-persist-journal-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("2026-05-11.md");
        let merged = "---\ndate: 2026-05-11\n---\n# A\n\n## 14:00\n\n# B\n";
        persist_journal(&path, merged).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), merged);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn prepare_idea_writes_nothing_when_run_claude_fails() {
        // Regression guard for the ack-before-persist invariant: if `run_claude`
        // fails inside `prepare_idea`, no FS side effect (no Ideas/ dir, no .md)
        // should appear. The test is meaningful only when `claude` is NOT on
        // PATH — skipped otherwise to avoid false greens on dev machines.
        if std::process::Command::new("claude")
            .arg("--version")
            .output()
            .is_ok()
        {
            eprintln!("skipping: `claude` is on PATH; test would hit the success path");
            return;
        }
        let dir = std::env::temp_dir().join("carnet-prepare-noclaude-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let result = prepare_idea("hi there", dir.to_str().unwrap()).await;
        assert!(result.is_err(), "expected run_claude failure");
        assert!(
            !dir.join("Ideas").exists(),
            "no FS side effect on Claude failure"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_person_writes_markdown() {
        let dir = std::env::temp_dir().join("carnet-persist-person-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Jane-Doe.md");
        let md = "---\nname: Jane Doe\n---\n# Jane Doe\n";
        persist_person(&path, md).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), md);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
