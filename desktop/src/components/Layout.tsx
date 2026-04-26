import { useState, type ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  detail: ReactNode;
  statusBar: ReactNode;
}

export function Layout({ sidebar, main, detail, statusBar }: LayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [detailWidth, setDetailWidth] = useState(340);
  const [showDetail, setShowDetail] = useState(true);

  function handleSidebarDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(180, Math.min(400, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleDetailDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailWidth;
    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(250, Math.min(600, startWidth - (ev.clientX - startX)));
      setDetailWidth(newWidth);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div
          className="flex-shrink-0 border-r border-(--color-border) bg-(--color-surface-dim) overflow-y-auto"
          style={{ width: sidebarWidth }}
        >
          {sidebar}
        </div>

        {/* Sidebar resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-(--color-accent)/30 active:bg-(--color-accent)/50 transition-colors flex-shrink-0"
          onMouseDown={handleSidebarDrag}
        />

        {/* Main conversation */}
        <div className="flex-1 min-w-0 flex flex-col">{main}</div>

        {/* Detail panel */}
        {showDetail && (
          <>
            <div
              className="w-1 cursor-col-resize hover:bg-(--color-accent)/30 active:bg-(--color-accent)/50 transition-colors flex-shrink-0"
              onMouseDown={handleDetailDrag}
            />
            <div
              className="flex-shrink-0 border-l border-(--color-border) overflow-y-auto"
              style={{ width: detailWidth }}
            >
              {detail}
            </div>
          </>
        )}
      </div>

      {/* Toggle detail panel button — inset into main area */}
      <button
        className="absolute right-2 top-2 z-10 w-7 h-7 flex items-center justify-center rounded text-xs text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
        onClick={() => setShowDetail(!showDetail)}
        title={showDetail ? "Hide detail panel" : "Show detail panel"}
      >
        {showDetail ? "▶" : "◀"}
      </button>

      {statusBar}
    </div>
  );
}
