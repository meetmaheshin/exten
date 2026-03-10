import { Marked } from "marked";
import hljs from "highlight.js";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Custom renderer for code blocks with copy button and language label
const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const label = lang || "code";
    let highlighted: string;
    try {
      highlighted = hljs.highlight(text, { language }).value;
    } catch {
      highlighted = hljs.highlightAuto(text).value;
    }

    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${label}</span>
        <button class="copy-btn" data-code="${escapeAttr(text)}">Copy</button>
      </div>
      <pre><code class="hljs language-${language}">${highlighted}</code></pre>
    </div>`;
  },
};

marked.use({ renderer });

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderMarkdown(source: string): string {
  return marked.parse(source) as string;
}
