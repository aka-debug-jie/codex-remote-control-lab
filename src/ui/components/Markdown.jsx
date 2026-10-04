import React, { useEffect, useMemo, useRef } from "react";
import { renderMarkdown, highlightCode } from "../lib/markdown.js";

// Split a streaming message at the last stable block boundary so only the tail
// block is re-parsed on each delta.
function incrementalSplit(text) {
  if (!text) return 0;
  const lines = text.split("\n");
  let offset = 0;
  let inFence = false;
  let safe = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const isFence = /^```/.test(trimmed);
    if (isFence) inFence = !inFence;
    offset += line.length + 1;
    if (!inFence && !isFence && trimmed === "") safe = offset;
  }
  return safe;
}

export const Markdown = React.memo(function Markdown({ text, streaming }) {
  const value = text || "";
  const split = streaming ? incrementalSplit(value) : value.length;
  const prefix = value.slice(0, split);
  const tail = value.slice(split);
  const prefixHtml = useMemo(() => renderMarkdown(prefix), [prefix]);
  const tailHtml = useMemo(() => renderMarkdown(tail), [tail]);
  const ref = useRef(null);

  useEffect(() => {
    if (streaming) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const handle = requestAnimationFrame(() => {
      for (const code of node.querySelectorAll("pre[data-language] code:not([data-hl])")) {
        const language = code.parentElement.getAttribute("data-language");
        code.innerHTML = highlightCode(code.textContent, language);
        code.setAttribute("data-hl", "1");
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [prefixHtml, tailHtml, streaming]);

  return (
    <div
      ref={ref}
      className={`entry-body${streaming ? " streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: prefixHtml + tailHtml }}
    />
  );
});
