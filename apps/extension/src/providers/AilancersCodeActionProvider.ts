import * as vscode from "vscode";

/**
 * Surfaces an "Ailancers: Fix this error" quick-fix on every diagnostic
 * (errors and warnings) under the cursor. Picking it sends a synthetic
 * user message to the chat with the error + surrounding code, asking
 * the agent to fix it.
 *
 * Wired in extension.ts via `registerCodeActionsProvider("*", ...)` so
 * it applies to every language. The actual prompt is dispatched by the
 * `ailancers.fixWithAilancers` command, also registered in extension.ts.
 */
export class AilancersCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (context.diagnostics.length === 0) return [];

    // One quick-fix per diagnostic — VS Code merges duplicates so emitting
    // multiple is fine. The action's `command` carries the diagnostic
    // payload through to the chat dispatcher.
    return context.diagnostics.map((d) => {
      const action = new vscode.CodeAction(
        `Ailancers: Fix "${this.summariseDiagnostic(d)}"`,
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: "ailancers.fixWithAilancers",
        title: "Fix with Ailancers",
        arguments: [
          {
            uri: document.uri.toString(),
            diagnostic: {
              message: d.message,
              severity: d.severity,
              code:
                typeof d.code === "object" && d.code !== null
                  ? String((d.code as { value?: unknown }).value ?? "")
                  : d.code != null
                    ? String(d.code)
                    : undefined,
              source: d.source,
              range: {
                start: { line: d.range.start.line, character: d.range.start.character },
                end: { line: d.range.end.line, character: d.range.end.character },
              },
            },
          },
        ],
      };
      action.diagnostics = [d];
      action.isPreferred = false; // Don't override the language's own auto-fix.
      return action;
    });
  }

  private summariseDiagnostic(d: vscode.Diagnostic): string {
    const m = d.message.split("\n")[0];
    return m.length > 60 ? m.slice(0, 57) + "…" : m;
  }
}
