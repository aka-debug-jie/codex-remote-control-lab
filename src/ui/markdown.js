// Markdown renderer ported from the original vanilla client.
import { authedUrl } from "./api.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripUiDirectives(text) {
  // Drop directive-only lines but never touch fenced code content.
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  const out = [];
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence && /^::[a-z0-9-]+\{[^\n]*\}$/i.test(line.trim())) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- lightweight, dependency-free syntax highlighting ---------------------
// Applied lazily (after streaming stops) by the Markdown component.

const CODE_KEYWORDS = {
  js: new Set("const let var function return if else for while do import from export default async await class extends new try catch finally throw typeof instanceof in of this super null undefined true false break continue switch case delete void yield static get set".split(" ")),
  ts: null,
  json: new Set(["true", "false", "null"]),
  bash: new Set("if then else fi for while do done case esac function export local return echo cd set source readonly".split(" ")),
  python: new Set("def class return if elif else for while import from as with try except finally raise lambda None True False and or not in is pass break continue yield async await self global".split(" ")),
};
CODE_KEYWORDS.ts = CODE_KEYWORDS.js;
const LINE_COMMENT = { js: "//", ts: "//", json: null, bash: "#", python: "#", diff: null };

function normalizeLang(lang) {
  const value = String(lang || "").toLowerCase();
  if (["js", "javascript", "jsx", "mjs", "cjs", "node"].includes(value)) return "js";
  if (["ts", "typescript", "tsx"].includes(value)) return "ts";
  if (["bash", "sh", "shell", "zsh", "console"].includes(value)) return "bash";
  if (["py", "python"].includes(value)) return "python";
  if (value === "json") return "json";
  if (value === "diff" || value === "patch") return "diff";
  return "";
}

export function highlightCode(code, lang) {
  const text = String(code ?? "");
  const key = normalizeLang(lang);
  if (!key) return escapeHtml(text);

  if (key === "diff") {
    return text
      .split("\n")
      .map((line) => {
        if (/^\+/.test(line)) return `<span class="hl-add">${escapeHtml(line)}</span>`;
        if (/^-/.test(line)) return `<span class="hl-del">${escapeHtml(line)}</span>`;
        if (/^@@/.test(line)) return `<span class="hl-meta">${escapeHtml(line)}</span>`;
        return escapeHtml(line);
      })
      .join("\n");
  }

  const comment = LINE_COMMENT[key];
  const keywords = CODE_KEYWORDS[key] || new Set();
  const pattern = new RegExp(
    [
      comment ? `(${comment.replace(/[/#]/g, "\\$&")}[^\\n]*)` : "(\\u0000)",
      "(\\\"(?:[^\\\"\\\\]|\\\\.)*\\\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)",
      "(\\b\\d+(?:\\.\\d+)?\\b)",
      "([A-Za-z_$][\\w$]*)",
    ].join("|"),
    "g",
  );
  let out = "";
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    out += escapeHtml(text.slice(last, match.index));
    if (match[1]) out += `<span class="hl-comment">${escapeHtml(match[1])}</span>`;
    else if (match[2]) out += `<span class="hl-string">${escapeHtml(match[2])}</span>`;
    else if (match[3]) out += `<span class="hl-number">${escapeHtml(match[3])}</span>`;
    else if (match[4]) {
      out += keywords.has(match[4]) ? `<span class="hl-keyword">${escapeHtml(match[4])}</span>` : escapeHtml(match[4]);
    }
    last = pattern.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function isBlockStart(line) {
  return (
    /^```/.test(line) ||
    /^#{1,4}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
}

function sanitizeHref(value) {
  try {
    const url = new URL(value, location.href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href;
  } catch {
    return "";
  }
  return "";
}

function isImageHref(value) {
  return /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(String(value || ""));
}

function normalizeImageHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // External absolute URLs are allowed but never get the bridge token.
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\.\//, "");
  if (clean.startsWith("/api/file/raw") || clean.startsWith("/api/uploaded")) {
    return authedUrl(clean);
  }
  const localPath = clean.replace(/[?#].*$/, "");
  const repoImage = localPath.match(/(?:^|[/\\])(docs[/\\](?:assets|public)[/\\].+\.(?:png|jpe?g|gif|webp|svg))$/i);
  if (repoImage) {
    return authedUrl(`/api/file/raw?path=${encodeURIComponent(repoImage[1].replace(/\\/g, "/"))}`);
  }
  if (/^[^?#]+\/[^?#]+\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(clean)) {
    return authedUrl(`/api/file/raw?path=${encodeURIComponent(localPath)}`);
  }
  if (/^[^/\\]+$/.test(clean) && isImageHref(clean)) {
    return authedUrl(`/api/file/raw?path=${encodeURIComponent(`docs/assets/${clean}`)}`);
  }
  return raw;
}

const ALLOWED_TAGS = new Set([
  "A", "B", "BR", "CODE", "DEL", "DETAILS", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
  "IMG", "KBD", "P", "PRE", "S", "SPAN", "STRONG", "SUB", "SUMMARY", "SUP", "TABLE", "TBODY",
  "TD", "TH", "THEAD", "TR", "UL", "OL", "LI",
]);

function sanitizeMarkdownHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const sanitizeNode = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ""));
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name.startsWith("on") || name === "style" || name === "class" || name === "id") {
          child.removeAttribute(attribute.name);
          continue;
        }
        if (child.tagName === "A" && name === "href") {
          const safeHref = sanitizeHref(value);
          if (safeHref) {
            child.setAttribute("href", safeHref);
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noreferrer");
          } else {
            child.removeAttribute(attribute.name);
          }
          continue;
        }
        if (child.tagName === "IMG" && name === "src") {
          child.setAttribute("src", normalizeImageHref(value));
          child.setAttribute("loading", "lazy");
          continue;
        }
        if (child.tagName === "IMG" && ["alt", "width", "height"].includes(name)) continue;
        if (["align", "colspan", "rowspan"].includes(name)) continue;
        child.removeAttribute(attribute.name);
      }
      sanitizeNode(child);
    }
  };
  sanitizeNode(template.content);
  return template.innerHTML;
}

function isHtmlBlockStart(line) {
  return /^<\/?(p|div|table|thead|tbody|tr|td|th|a|img|br|h[1-6]|details|summary)\b/i.test(line.trim());
}

function renderInlineMarkdown(text) {
  const codeTokens = [];
  const imageTokens = [];
  const linkTokens = [];
  let source = String(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(escapeHtml(code));
    return token;
  });

  // Extract images and links from the RAW source (before escaping) so `&` in
  // query strings is not double-escaped and token placeholders stay intact.
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, href) => {
    if (!isImageHref(href)) return match;
    const token = `\u0000IMAGE${imageTokens.length}\u0000`;
    imageTokens.push({ name: label || href.split("/").pop(), url: normalizeImageHref(href) });
    return token;
  });

  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    if (isImageHref(href)) {
      const token = `\u0000IMAGE${imageTokens.length}\u0000`;
      imageTokens.push({ name: label, url: normalizeImageHref(href) });
      return token;
    }
    const safeHref = sanitizeHref(href);
    const inner = escapeHtml(label);
    const html = safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
    const token = `\u0000LINK${linkTokens.length}\u0000`;
    linkTokens.push(html);
    return token;
  });

  source = escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return source
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => `<code>${codeTokens[Number(index)] || ""}</code>`)
    .replace(/\u0000LINK(\d+)\u0000/g, (_, index) => linkTokens[Number(index)] || "")
    .replace(/\u0000IMAGE(\d+)\u0000/g, (_, index) => {
      const image = imageTokens[Number(index)];
      if (!image) return "";
      return `<figure class="image-preview markdown-image"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || "image")}" loading="lazy"><figcaption>${escapeHtml(image.name || "image")}</figcaption></figure>`;
    });
}

export function renderMarkdown(text, options = {}) {
  const headingOffset = options.headingOffset ?? 1;
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (options.allowHtml && isHtmlBlockStart(line)) {
      const html = [line];
      const open = line.trim().match(/^<([a-z0-9]+)\b/i)?.[1]?.toLowerCase();
      index += 1;
      while (index < lines.length && lines[index].trim() && open && !new RegExp(`</${open}>`, "i").test(html.join("\n"))) {
        html.push(lines[index]);
        index += 1;
      }
      blocks.push(sanitizeMarkdownHtml(html.join("\n")));
      continue;
    }

    const fence = line.match(/^```\s*([a-zA-Z0-9_+#.-]+)?\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` data-language="${escapeHtml(fence[1])}"` : "";
      blocks.push(`<pre${language}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + headingOffset, 6);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return blocks.join("");
}
