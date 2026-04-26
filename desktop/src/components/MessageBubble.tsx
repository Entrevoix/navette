interface MessageBubbleProps {
  text: string;
  role: "assistant" | "user";
}

export function MessageBubble({ text, role }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-(--color-accent) text-white rounded-br-sm"
            : "bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) rounded-bl-sm"
        }`}
      >
        {renderMarkdown(text)}
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> = [];
  let lastIndex = 0;

  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[2], lang: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  if (parts.length === 0) return text;

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "code") {
          return (
            <pre
              key={i}
              className="my-2 p-3 rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-xs font-mono overflow-x-auto"
            >
              {part.lang && (
                <div className="text-xs text-(--color-text-muted) mb-1">
                  {part.lang}
                </div>
              )}
              <code>{part.content}</code>
            </pre>
          );
        }
        return <span key={i}>{renderInlineCode(part.content)}</span>;
      })}
    </>
  );
}

function renderInlineCode(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded bg-(--color-surface-dim) text-xs font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
