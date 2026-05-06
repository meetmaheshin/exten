import { Marked } from "marked";
import hljs from "highlight.js";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Detect VS Code theme once at module load time and map to a wrapper class.
// Values from VS Code: "vscode-light", "vscode-dark", "vscode-high-contrast",
// "vscode-high-contrast-light".
function detectThemeClass(): string {
  const kind =
    (typeof document !== "undefined" &&
      document.body &&
      document.body.dataset.vscodeThemeKind) ||
    "";
  if (kind === "vscode-light") return "theme-light";
  if (kind === "vscode-high-contrast" || kind === "vscode-high-contrast-light")
    return "theme-hc";
  // Default to dark (also covers "vscode-dark" and any unknown value).
  return "theme-dark";
}

const themeClass = detectThemeClass();

// Known file extensions for the file-link detector. Limited to common code /
// config / doc extensions so we don't accidentally rewrite arbitrary text.
const FILE_EXT_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|css|scss|sass|less|html|htm|xml|yml|yaml|toml|ini|env|sh|bash|zsh|ps1|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|cs|php|sql|graphql|gql|vue|svelte|astro|lock|gitignore|dockerfile|makefile)$/i;

// Matches the form `path[:line[-endLine]]`.
// Capture groups: 1 = path, 2 = startLine (optional), 3 = endLine (optional).
const FILE_LINK_RE = /^([^\s?#]+?)(?::(\d+)(?:-(\d+))?)?$/;

function isFileLinkHref(href: string): boolean {
  if (!href) return false;
  if (/^(https?:|mailto:|ftp:|file:)/i.test(href)) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  const m = FILE_LINK_RE.exec(href);
  if (!m) return false;
  const path = m[1];
  // Must look like a file: contains a slash, OR has a recognized extension.
  if (path.includes("/") || path.includes("\\")) return true;
  if (FILE_EXT_RE.test(path)) return true;
  return false;
}

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

    // Split highlighted HTML by newline. hljs emits literal "\n" characters
    // even inside <span> wrappers, so this preserves token coloring across
    // the split.
    const allLines = highlighted.split("\n");
    const totalLines = allLines.length;
    const LIMIT = 30;

    if (totalLines > LIMIT) {
      const visibleHtml = allLines.slice(0, LIMIT).join("\n");
      const restHtml = allLines.slice(LIMIT).join("\n");
      return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${label}</span>
        <span class="code-block-truncated">${totalLines} lines, showing first ${LIMIT}</span>
        <button class="copy-btn" data-code="${escapeAttr(text)}">Copy</button>
      </div>
      <pre><code class="hljs language-${language}">${visibleHtml}</code></pre>
      <details class="code-block-rest">
        <summary>Show all ${totalLines} lines</summary>
        <pre><code class="hljs language-${language}">${restHtml}</code></pre>
      </details>
    </div>`;
    }

    return `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${label}</span>
        <button class="copy-btn" data-code="${escapeAttr(text)}">Copy</button>
      </div>
      <pre><code class="hljs language-${language}">${highlighted}</code></pre>
    </div>`;
  },

  link({
    href,
    title,
    tokens,
  }: {
    href: string;
    title?: string | null;
    tokens: Array<{ raw?: string; text?: string }>;
  }) {
    // Render inner text from tokens via the parser so nested markdown still
    // works (e.g. **bold** inside a link).
    const innerHtml = (this as unknown as { parser: { parseInline(t: unknown): string } })
      .parser.parseInline(tokens);

    if (isFileLinkHref(href)) {
      const m = FILE_LINK_RE.exec(href)!;
      const path = m[1];
      const startLine = m[2];
      const endLine = m[3];
      const dataLine = startLine ? ` data-line="${escapeAttr(startLine)}"` : "";
      const dataEndLine = endLine
        ? ` data-end-line="${escapeAttr(endLine)}"`
        : "";
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a class="file-link" data-path="${escapeAttr(path)}"${dataLine}${dataEndLine}${titleAttr}>${innerHtml}</a>`;
    }

    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    return `<a href="${escapeAttr(href)}"${titleAttr}>${innerHtml}</a>`;
  },
};

/**
 * Inline-token extension that detects bare file paths in prose and renders
 * them as `.file-link` anchors. Only triggers on tokens that look unambiguously
 * like a path: must contain a slash and end with a recognised extension, or
 * end with `:<line>` / `:<line>-<end>`. Won't fire inside links (marked already
 * tokenised those) or code spans (those go through a different path).
 *
 * Examples that match: `src/foo.ts`, `apps/extension/src/x.ts:42`, `./bar.json`.
 * Examples that don't: `foo.ts` (no slash — too noisy), `https://...` (URL).
 */
const BARE_PATH_RE =
  /(^|[\s(\[`'"])((?:\.{1,2}\/|\/|[\w@-]+\/)[\w./@_-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|css|scss|sass|less|html|htm|xml|yml|yaml|toml|ini|env|sh|bash|zsh|ps1|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|cs|php|sql|graphql|gql|vue|svelte|astro|lock)(?::\d+(?:-\d+)?)?)/;

marked.use({
  extensions: [
    {
      name: "barePath",
      level: "inline",
      // Quick prefilter so marked doesn't run the regex on every token.
      start(src: string) {
        const m = /(?:^|[\s(\[`'"])(?:\.{1,2}\/|\/|[\w@-]+\/)/.exec(src);
        return m ? m.index : -1;
      },
      tokenizer(src: string) {
        const m = BARE_PATH_RE.exec(src);
        if (!m || m.index !== 0) return undefined;
        // Strip the leading boundary character — it's not part of the path.
        const lead = m[1] ?? "";
        const path = m[2];
        return {
          type: "barePath",
          raw: lead + path,
          lead,
          path,
        };
      },
      renderer(genericToken: unknown) {
        const token = genericToken as { lead: string; path: string };
        const m = FILE_LINK_RE.exec(token.path);
        if (!m) return token.lead + escapeAttr(token.path);
        const filePath = m[1];
        const startLine = m[2];
        const endLine = m[3];
        const dataLine = startLine ? ` data-line="${escapeAttr(startLine)}"` : "";
        const dataEnd = endLine ? ` data-end-line="${escapeAttr(endLine)}"` : "";
        return `${token.lead}<a class="file-link" data-path="${escapeAttr(filePath)}"${dataLine}${dataEnd}>${escapeAttr(token.path)}</a>`;
      },
    },
  ],
});

marked.use({ renderer });

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  return `<div class="markdown-body ${themeClass}">${html}</div>`;
}
