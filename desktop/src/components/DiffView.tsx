interface DiffViewProps {
  content: string;
}

export function DiffView({ content }: DiffViewProps) {
  const lines = content.split("\n");

  return (
    <div className="rounded-lg border border-(--color-border) overflow-hidden text-xs font-mono">
      {lines.map((line, i) => {
        let cls = "px-3 py-0.5 whitespace-pre-wrap break-all";
        if (line.startsWith("+++") || line.startsWith("---")) {
          cls += " bg-(--color-surface-dim) text-(--color-text-muted) font-medium";
        } else if (line.startsWith("@@")) {
          cls += " bg-(--color-info)/10 text-(--color-info)";
        } else if (line.startsWith("+")) {
          cls += " bg-(--color-success)/10 text-(--color-success)";
        } else if (line.startsWith("-")) {
          cls += " bg-(--color-danger)/10 text-(--color-danger)";
        } else {
          cls += " text-(--color-text-muted)";
        }

        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}
