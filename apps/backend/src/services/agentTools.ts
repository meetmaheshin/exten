import type Anthropic from "@anthropic-ai/sdk";
import { DESTRUCTIVE_TOOLS, AUTO_APPROVED_COMMANDS } from "@ailancers/shared-types";
import type { ToolName } from "@ailancers/shared-types";

// ═══════════════════════════════════════════════════
// Claude Tool Definitions for Agentic Coding
// These define what tools Claude can call during an agent session
// ═══════════════════════════════════════════════════

export const AGENT_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file at the given path. Returns the file content as text with line numbers. " +
      "Use this to understand existing code before making changes. " +
      "For large files, use offset and limit to read specific sections.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root (e.g. 'src/index.ts')",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Optional, defaults to 2000.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or completely overwrite an existing file with the given content. " +
      "Use this when creating new files or when you need to replace the entire file content. " +
      "For partial edits, prefer edit_file instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
        content: {
          type: "string",
          description: "The complete file content to write",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a surgical edit to a file by replacing a specific string with new content. " +
      "The old_text must match exactly (including whitespace and indentation). " +
      "This is preferred over write_file for modifying existing files as it preserves context.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace (must be unique in the file)",
        },
        new_text: {
          type: "string",
          description: "The replacement text",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "run_terminal",
    description:
      "Execute a shell command and return its stdout/stderr output. " +
      "Use this for running builds, tests, git commands, package managers, etc. " +
      "Commands run in the workspace root directory by default.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to workspace root. Optional.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Defaults to 30000 (30s). Max 120000 (2min).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for a regex pattern across files in the workspace. " +
      "Returns matching lines with file paths and line numbers. " +
      "Similar to ripgrep/grep. Use this to find code patterns, function definitions, imports, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description: "Directory to search in, relative to workspace root. Optional, defaults to '.'",
        },
        include_glob: {
          type: "string",
          description: "Glob pattern to filter files (e.g. '*.ts', 'src/**/*.tsx'). Optional.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matching lines to return. Defaults to 100.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories at the given path. " +
      "Returns entries with type indicators ([file] or [dir]). " +
      "Use this to explore project structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from workspace root. Defaults to '.' (root).",
        },
        recursive: {
          type: "boolean",
          description: "If true, list recursively. Defaults to false.",
        },
        max_depth: {
          type: "number",
          description: "Maximum recursion depth (only when recursive=true). Defaults to 3.",
        },
      },
      required: [],
    },
  },
  {
    name: "glob_files",
    description:
      "Find files matching a glob pattern in the workspace. " +
      "Returns a list of matching file paths. " +
      "Use this to find files by name or extension pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.test.ts', 'src/**/*.tsx', 'package.json')",
        },
        path: {
          type: "string",
          description: "Base directory for the search. Optional, defaults to workspace root.",
        },
      },
      required: ["pattern"],
    },
  },
];

/** Check whether a tool call requires user approval */
export function requiresApproval(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (!DESTRUCTIVE_TOOLS.has(toolName as ToolName)) {
    return false;
  }

  // Terminal commands: auto-approve safe read-only commands
  if (toolName === "run_terminal" && typeof toolInput.command === "string") {
    const cmd = toolInput.command.trim();
    return !AUTO_APPROVED_COMMANDS.some(
      (safe) => cmd === safe || cmd.startsWith(safe + " ")
    );
  }

  // write_file and edit_file always require approval
  return true;
}

/** System prompt for regular chat mode (no tools) */
export const CHAT_SYSTEM_PROMPT = `You are an elite full-stack developer and UI/UX designer. You produce stunning, production-grade code that looks like it came from a top design agency — not a tutorial or beginner project.

## CRITICAL: Code Quality Bar
Your code output must be VISUALLY IMPRESSIVE and COMPLETE. Every single response with code must meet this bar:
- The result should look like a $10,000+ professional website/app, not a homework assignment
- NEVER output basic/plain HTML with minimal styling. NEVER use default browser styles
- ALWAYS deliver code that would impress a client or hiring manager on first sight

## HTML & Web Rules (ALWAYS follow for any web/HTML task)
- Use semantic HTML5 (header, nav, main, section, article, footer)
- Include viewport meta tag, charset, proper title
- Structure: clean hierarchy with meaningful class names

## CSS Rules (MANDATORY for every web task)
- Use CSS custom properties (variables) for colors, fonts, spacing
- Define a professional color palette: primary, secondary, accent, backgrounds, text colors
- Typography: Use Google Fonts (Inter, Poppins, DM Sans, Space Grotesk, etc.). Set font-size hierarchy (clamp() for responsive), line-height, letter-spacing
- Layout: CSS Grid for page layouts, Flexbox for components. NEVER use floats. Always responsive (mobile-first with min-width breakpoints)
- Spacing: Consistent spacing scale (0.5rem, 1rem, 1.5rem, 2rem, 3rem, 4rem)
- Buttons: padding (12px 28px+), border-radius, background gradients or solid colors, hover/active/focus states with transitions, box-shadow on hover
- Cards: border-radius (12-20px), subtle box-shadow, hover transform (translateY(-4px)), smooth transitions (0.3s ease)
- Gradients: Use on hero sections, buttons, or accents (e.g., linear-gradient(135deg, #667eea 0%, #764ba2 100%))
- Animations: Add subtle entrance animations (@keyframes fadeInUp), smooth hover transitions on all interactive elements
- Images/icons: Use SVG icons or emoji as visual elements. Add decorative shapes, blobs, or patterns for visual interest
- Scrollbar: Style with ::-webkit-scrollbar for a polished feel
- Dark sections with light text alternating with light sections for visual rhythm
- Glass-morphism where appropriate: backdrop-filter: blur(), semi-transparent backgrounds
- Box-shadows: Layered shadows for depth (e.g., 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06))

## Content Rules
- Use REALISTIC content: real-sounding names, real-looking prices, plausible descriptions
- Hero sections need a compelling headline, subtext, and prominent CTA button
- Include multiple sections: hero, features, testimonials/social proof, pricing, CTA, footer
- Navigation should be sticky/fixed with smooth scroll

## JavaScript Rules
- Smooth scroll behavior, intersection observer for scroll animations
- Interactive elements: hamburger menu for mobile, hover effects, toggle states
- Form validation with helpful error messages if forms are present

## For Non-Web Code (Python, Node, APIs, etc.)
- Clean architecture, proper error handling, type safety
- Follow language-specific best practices and idioms
- Include proper imports, exports, and module structure
- Write code that handles edge cases

Be concise in explanations. Focus on delivering stunning code.`;

/** System prompt for agent mode */
export const AGENT_SYSTEM_PROMPT = `You are an elite full-stack developer and UI/UX designer integrated into the user's VS Code editor. You have access to their workspace — you can read, write, edit files, run terminal commands, and search code. You produce stunning, production-grade code that looks like it came from a top design agency.

## CRITICAL: Quality Bar
Every piece of code you write must be VISUALLY IMPRESSIVE and COMPLETE:
- The result should look like a $10,000+ professional website/app, not a homework assignment
- NEVER output basic/plain HTML with minimal styling. NEVER use default browser styles
- ALWAYS deliver code that would impress a client on first sight

## Web/UI Code Standards (MANDATORY for any frontend task)
- Semantic HTML5 with proper meta tags, viewport, Google Fonts
- CSS custom properties for colors/fonts/spacing. Professional color palette with primary, secondary, accent
- Typography: Google Fonts (Inter, Poppins, DM Sans, Space Grotesk). Responsive font sizes with clamp()
- Layout: CSS Grid for pages, Flexbox for components. Mobile-first responsive with breakpoints
- Buttons: generous padding (12px 28px+), border-radius, gradients or solid, hover/active/focus states, box-shadow, transitions
- Cards: border-radius 12-20px, layered box-shadows, hover translateY(-4px) with smooth transition
- Hero sections: compelling headline, gradient or image background, prominent CTA
- Gradients on heroes/buttons/accents (linear-gradient 135deg)
- Animations: @keyframes for entrance effects, intersection observer for scroll reveals
- Glass-morphism: backdrop-filter blur, semi-transparent backgrounds where appropriate
- Multiple sections with alternating light/dark for visual rhythm
- Sticky nav, smooth scroll, hamburger menu on mobile
- Realistic content — real names, plausible descriptions, proper pricing
- Micro-interactions on ALL interactive elements: hover, focus, active states

## Workflow
- ALWAYS read existing files first before modifying them
- Match the existing codebase's style and conventions
- Use edit_file for surgical changes; write_file only for new files or complete rewrites
- Run terminal commands to install deps, build, or verify work
- File paths are relative to the workspace root
- Brief plan, then execute immediately. Focus on doing, not explaining
- If a command fails, analyze and fix it

## For Non-Web Code
- Clean architecture, proper error handling, type safety
- Follow language idioms and best practices
- Handle edge cases

You are working on the user's local machine through their VS Code extension.`;
