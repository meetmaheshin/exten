import * as vscode from "vscode";
import type { ApiClient } from "./ApiClient";

/**
 * Reads the staged diff via VS Code's built-in Git extension API and asks
 * the backend for a Conventional-Commits-style message. Result is written
 * directly into the SCM input box of the active repository.
 *
 * The Git extension is bundled with VS Code on every install; if it's not
 * available (e.g. user disabled it) we surface a helpful message instead
 * of silently failing.
 */
export class CommitMessageService {
  constructor(private apiClient: ApiClient) {}

  /** Public entry point — wired to `ailancers.generateCommitMessage`. */
  async generate(): Promise<void> {
    const gitExt = vscode.extensions.getExtension<{
      getAPI(version: 1): GitExtensionApi;
    }>("vscode.git");
    if (!gitExt) {
      void vscode.window.showWarningMessage(
        "VS Code's built-in Git extension is required to generate commit messages.",
      );
      return;
    }
    const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
    const api = git.getAPI(1);
    if (!api.repositories || api.repositories.length === 0) {
      void vscode.window.showWarningMessage("No Git repository found in this workspace.");
      return;
    }
    // If the user has multiple repos, target the one whose root is the
    // closest ancestor of the active editor / first folder. Falls back to
    // the first repo if neither rule matches.
    const repo = this.pickRepo(api.repositories);
    if (!repo) {
      void vscode.window.showWarningMessage("Couldn't pick a Git repository to use.");
      return;
    }

    const rawDiff = await this.fetchStagedDiff(repo);
    if (!rawDiff || rawDiff.trim().length === 0) {
      void vscode.window.showInformationMessage(
        "Nothing staged. `git add` your changes, then try again.",
      );
      return;
    }

    // Cap the diff so we don't blow the prompt on large refactors. ~16K is
    // enough for ~300-500 line diffs at typical density; anything beyond
    // that is summarised by the model anyway.
    const diff = rawDiff.length > 16_000 ? rawDiff.slice(0, 16_000) + "\n…(diff truncated)" : rawDiff;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.SourceControl,
        title: "Ailancers: generating commit message…",
        cancellable: false,
      },
      async () => {
        try {
          const response = await this.apiClient.post<{ message: string }>(
            "/api/commit-message",
            { diff },
          );
          if (!response.message) {
            void vscode.window.showWarningMessage(
              "Backend returned an empty commit message. Try staging fewer files?",
            );
            return;
          }
          // SCM input replaces, not appends — same UX as Copilot's button.
          repo.inputBox.value = response.message.trim();
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(
            `Couldn't generate commit message: ${reason}`,
          );
        }
      },
    );
  }

  /** Best repo for the current workspace state. Falls back to first repo. */
  private pickRepo(repos: GitRepository[]): GitRepository | null {
    if (repos.length === 1) return repos[0];
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === "file") {
      const path = editor.document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
      let best: { repo: GitRepository; depth: number } | null = null;
      for (const r of repos) {
        const root = r.rootUri.fsPath.replace(/\\/g, "/").toLowerCase();
        if (path.startsWith(root + "/") || path === root) {
          const depth = root.length;
          if (!best || depth > best.depth) best = { repo: r, depth };
        }
      }
      if (best) return best.repo;
    }
    return repos[0] ?? null;
  }

  /** Pulls the staged diff using the Git extension's `diff(true)` overload. */
  private async fetchStagedDiff(repo: GitRepository): Promise<string> {
    try {
      // The Git API's `diff(cached: boolean)` overload returns the staged
      // diff when cached === true. Same as `git diff --cached`.
      const out = await repo.diff(true);
      return out ?? "";
    } catch {
      return "";
    }
  }
}

// ─── Minimal subset of VS Code's Git extension API ──────────────
// Avoids pulling in the full @types/vscode-git typings. We only need
// `repositories[].diff(true)` and `inputBox.value`.

interface GitExtensionApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  diff(cached?: boolean): Promise<string>;
}
