import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "../store/connectionStore";
import type { DirEntry, DirListingEvent, FileContentEvent } from "../types";

export function FileBrowser() {
  const ws = useConnectionStore((s) => s.ws);

  const [path, setPath] = useState("~");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listDir = useCallback(
    (target: string) => {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setFilePath(null);
      ws.send({ type: "list_dir", path: target });
    },
    [ws],
  );

  useEffect(() => {
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "dir_listing") {
        const ev = msg as unknown as DirListingEvent;
        setLoading(false);
        if (ev.error) {
          setError(ev.error);
        } else {
          setPath(ev.path);
          const sorted = [...ev.entries].sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          setEntries(sorted);
        }
      }
      if (msg.type === "file_content") {
        const ev = msg as unknown as FileContentEvent;
        setLoading(false);
        if (ev.error) {
          setError(ev.error);
        } else {
          setFileContent(ev.content ?? "");
          setFilePath(ev.path);
        }
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    listDir("~");
  }, [listDir]);

  function handleEntryClick(entry: DirEntry) {
    const target = path === "~" ? `~/${entry.name}` : `${path}/${entry.name}`;
    if (entry.is_dir) {
      listDir(target);
    } else {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setFilePath(null);
      ws.send({ type: "read_file", path: target });
    }
  }

  function handleUp() {
    if (path === "~" || path === "/") return;
    const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
    const parent = normalized.includes("/")
      ? normalized.substring(0, normalized.lastIndexOf("/")) || "/"
      : "~";
    listDir(parent || "/");
  }

  const breadcrumbParts = path === "~" ? ["~"] : path.split("/").filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-(--color-surface)">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--color-border) flex items-center gap-2">
        <button
          onClick={handleUp}
          disabled={path === "~" || path === "/"}
          className="px-2 py-1 text-xs rounded border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-dim) disabled:opacity-40 transition-colors"
          title="Go up"
        >
          ↑ Up
        </button>
        <div className="flex items-center gap-1 flex-1 overflow-x-auto text-sm text-(--color-text-muted) min-w-0">
          {path === "~" ? (
            <span className="text-(--color-text)">~</span>
          ) : (
            breadcrumbParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <span className="opacity-40">/</span>}
                <span
                  className={
                    i === breadcrumbParts.length - 1
                      ? "text-(--color-text)"
                      : "cursor-pointer hover:text-(--color-accent) transition-colors"
                  }
                  onClick={() => {
                    if (i < breadcrumbParts.length - 1) {
                      const target = "/" + breadcrumbParts.slice(0, i + 1).join("/");
                      listDir(target);
                    }
                  }}
                >
                  {part}
                </span>
              </span>
            ))
          )}
        </div>
        {loading && (
          <span className="text-xs text-(--color-text-muted) animate-pulse shrink-0">
            Loading…
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-(--color-danger)/10 border border-(--color-danger)/30 text-sm text-(--color-danger)">
          {error}
        </div>
      )}

      {/* File content view */}
      {fileContent !== null && filePath !== null ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-(--color-border) flex items-center justify-between">
            <span className="text-xs text-(--color-text-muted) truncate">{filePath}</span>
            <button
              onClick={() => {
                setFileContent(null);
                setFilePath(null);
              }}
              className="text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors ml-2 shrink-0"
            >
              ✕ Close
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs text-(--color-text) font-mono leading-relaxed whitespace-pre">
            {fileContent || <span className="text-(--color-text-muted) italic">Empty file</span>}
          </pre>
        </div>
      ) : (
        /* Directory listing */
        <div className="flex-1 overflow-y-auto p-2">
          {!loading && entries.length === 0 && !error && (
            <p className="text-sm text-(--color-text-muted) text-center py-8">
              Empty directory
            </p>
          )}
          {entries.map((entry) => (
            <button
              key={entry.name}
              onClick={() => handleEntryClick(entry)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-(--color-surface-bright) transition-colors"
            >
              <span className="text-base leading-none shrink-0">
                {entry.is_dir ? "📁" : "📄"}
              </span>
              <span
                className={`text-sm truncate ${
                  entry.is_dir
                    ? "text-(--color-text) font-medium"
                    : "text-(--color-text-muted)"
                }`}
              >
                {entry.name}
              </span>
              {entry.is_dir && (
                <span className="ml-auto text-xs text-(--color-text-muted) opacity-50 shrink-0">
                  /
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
