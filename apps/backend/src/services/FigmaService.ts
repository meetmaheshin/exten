import type { Env } from "../config/env.js";

const FIGMA_API = "https://api.figma.com/v1";

/** Parsed pieces from a Figma URL */
export interface FigmaUrlParts {
  fileKey: string;
  /** Optional node-id query param. Figma URLs encode it as e.g. "42-100"; the
   *  REST API expects "42:100" — we normalize here. */
  nodeId: string | null;
  /** True if URL was a /design/ link, false for /file/ (both supported by Figma) */
  isDesign: boolean;
}

/** Loose subset of the Figma node tree we actually return to the agent */
export interface FigmaNodeSummary {
  id: string;
  name: string;
  type: string;
  /** Frame-level layout (for top-level container nodes) */
  size?: { width: number; height: number };
  /** Resolved fills with hex codes — handy for design tokens */
  colors?: string[];
  /** Text content if this is a TEXT node */
  text?: string;
  /** Font name + size if TEXT */
  font?: { family: string; size: number; weight?: number };
  /** Shallow children — the agent recurses by calling read again on a sub-node URL */
  children?: FigmaNodeSummary[];
}

export interface FigmaReadResult {
  fileName: string;
  /** The summarized tree, capped in depth so the response stays compact */
  tree: FigmaNodeSummary;
  /** Direct PNG image of the requested node (or root frame if no node-id), base64-encoded */
  image: { mimeType: "image/png"; base64: string } | null;
  /** Raw image URL Figma returns — short-lived, useful for debugging */
  imageSourceUrl: string | null;
}

/** Parse a Figma URL into its file-key and optional node-id */
export function parseFigmaUrl(rawUrl: string): FigmaUrlParts | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith("figma.com")) return null;

  // Path patterns:
  //   /design/<key>/<slug?>...
  //   /file/<key>/<slug?>...
  //   /board/<key>/<slug?>... (FigJam — we don't render those usefully but pass through)
  const m = url.pathname.match(/^\/(design|file|board)\/([A-Za-z0-9]+)/);
  if (!m) return null;

  const isDesign = m[1] !== "file";
  const fileKey = m[2];

  // node-id may show up as "42-100" or "42%3A100"; either way Figma's REST API
  // wants the colon form ("42:100").
  let nodeId: string | null = url.searchParams.get("node-id");
  if (nodeId) {
    nodeId = decodeURIComponent(nodeId).replace(/-/g, ":");
  }

  return { fileKey, nodeId, isDesign };
}

/** Convert a Figma fill paint to a hex string. Returns null for non-solid fills. */
function paintToHex(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const paint = p as { type?: string; color?: { r: number; g: number; b: number; a?: number }; visible?: boolean; opacity?: number };
  if (paint.visible === false) return null;
  if (paint.type !== "SOLID" || !paint.color) return null;
  const r = Math.round(paint.color.r * 255);
  const g = Math.round(paint.color.g * 255);
  const b = Math.round(paint.color.b * 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Recursively summarize a Figma node, capping depth so we don't blow the context */
function summarizeNode(node: unknown, depth = 0, maxDepth = 3): FigmaNodeSummary {
  const n = node as {
    id: string;
    name: string;
    type: string;
    absoluteBoundingBox?: { width: number; height: number };
    fills?: unknown[];
    characters?: string;
    style?: { fontFamily?: string; fontSize?: number; fontWeight?: number };
    children?: unknown[];
  };

  const summary: FigmaNodeSummary = {
    id: n.id,
    name: n.name,
    type: n.type,
  };

  if (n.absoluteBoundingBox) {
    summary.size = {
      width: Math.round(n.absoluteBoundingBox.width),
      height: Math.round(n.absoluteBoundingBox.height),
    };
  }

  if (Array.isArray(n.fills) && n.fills.length > 0) {
    const colors = n.fills.map(paintToHex).filter((c): c is string => c !== null);
    if (colors.length > 0) summary.colors = colors;
  }

  if (n.type === "TEXT") {
    if (typeof n.characters === "string") {
      // Cap text per node so a giant terms-of-service page doesn't drown the response
      summary.text = n.characters.length > 500 ? n.characters.slice(0, 500) + "…" : n.characters;
    }
    if (n.style?.fontFamily) {
      summary.font = {
        family: n.style.fontFamily,
        size: n.style.fontSize ?? 0,
        weight: n.style.fontWeight,
      };
    }
  }

  if (depth < maxDepth && Array.isArray(n.children) && n.children.length > 0) {
    summary.children = n.children.slice(0, 50).map((c) => summarizeNode(c, depth + 1, maxDepth));
  }

  return summary;
}

/** Hit the Figma API. Returns null if the env token isn't configured. */
export class FigmaService {
  constructor(private env: Env) {}

  get isConfigured(): boolean {
    return this.env.FIGMA_TOKEN.length > 0;
  }

  async readUrl(rawUrl: string): Promise<FigmaReadResult> {
    if (!this.isConfigured) {
      throw new Error(
        "Figma is not configured on this server. Set FIGMA_TOKEN in the backend .env to a Personal Access Token from https://www.figma.com/settings.",
      );
    }
    const parts = parseFigmaUrl(rawUrl);
    if (!parts) {
      throw new Error(`That doesn't look like a Figma URL. Expected something like https://www.figma.com/design/<key>/<title>?node-id=42-100, got: ${rawUrl}`);
    }

    const headers = { "X-Figma-Token": this.env.FIGMA_TOKEN };

    // 1) Fetch the file's metadata + the relevant node subtree
    let fileName = "Figma file";
    let tree: FigmaNodeSummary;

    if (parts.nodeId) {
      // /v1/files/{key}/nodes?ids={id1},{id2}
      const url = `${FIGMA_API}/files/${encodeURIComponent(parts.fileKey)}/nodes?ids=${encodeURIComponent(parts.nodeId)}&depth=4`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Figma API ${resp.status}: ${text.slice(0, 200)}`);
      }
      const data = await resp.json() as { name?: string; nodes?: Record<string, { document?: unknown } | null> };
      fileName = data.name ?? fileName;
      const node = data.nodes?.[parts.nodeId];
      if (!node || !node.document) {
        throw new Error(`Figma node ${parts.nodeId} not found in file ${parts.fileKey}.`);
      }
      tree = summarizeNode(node.document);
    } else {
      // No node-id — fetch the file root and summarize its first page
      const url = `${FIGMA_API}/files/${encodeURIComponent(parts.fileKey)}?depth=3`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Figma API ${resp.status}: ${text.slice(0, 200)}`);
      }
      const data = await resp.json() as { name?: string; document?: unknown };
      fileName = data.name ?? fileName;
      tree = summarizeNode(data.document);
    }

    // 2) Render a PNG of the node (or root if none) so Claude can SEE the design
    let image: FigmaReadResult["image"] = null;
    let imageSourceUrl: string | null = null;
    const renderId = parts.nodeId ?? tree.id;
    if (renderId) {
      try {
        const renderUrl = `${FIGMA_API}/images/${encodeURIComponent(parts.fileKey)}?ids=${encodeURIComponent(renderId)}&format=png&scale=2`;
        const renderResp = await fetch(renderUrl, { headers });
        if (renderResp.ok) {
          const renderData = await renderResp.json() as { images?: Record<string, string | null> };
          const pngUrl = renderData.images?.[renderId];
          if (pngUrl) {
            imageSourceUrl = pngUrl;
            // Figma returns a short-lived AWS URL — fetch the bytes ourselves so the
            // extension can pass them straight to Claude as an image content block.
            const pngResp = await fetch(pngUrl);
            if (pngResp.ok) {
              const buf = Buffer.from(await pngResp.arrayBuffer());
              // Cap at 5 MB so a huge frame doesn't blow up the response
              if (buf.byteLength <= 5 * 1024 * 1024) {
                image = { mimeType: "image/png", base64: buf.toString("base64") };
              }
            }
          }
        }
      } catch {
        // Image render failure is non-fatal — agent can still reason from the tree
      }
    }

    return { fileName, tree, image, imageSourceUrl };
  }
}
