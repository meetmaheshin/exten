import * as vscode from "vscode";

export class ApprovalService {
  // Tools auto-approved for the rest of the session
  private sessionAutoApproved = new Set<string>();

  async requestApproval(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
    // Check if auto-approved for this session
    if (this.sessionAutoApproved.has(toolName)) {
      return true;
    }

    const { title, detail } = this.formatApproval(toolName, toolInput);

    const result = await vscode.window.showInformationMessage(
      title,
      { modal: true, detail },
      "Allow",
      "Allow All This Session",
      "Deny"
    );

    if (result === "Allow All This Session") {
      this.sessionAutoApproved.add(toolName);
      return true;
    }

    return result === "Allow";
  }

  /** Reset session-level auto-approvals (call when conversation changes) */
  resetSession(): void {
    this.sessionAutoApproved.clear();
  }

  private formatApproval(
    toolName: string,
    toolInput: Record<string, unknown>
  ): { title: string; detail: string } {
    switch (toolName) {
      case "write_file": {
        const path = toolInput.path as string || "unknown";
        const content = toolInput.content as string || "";
        const lines = content.split("\n").length;
        return {
          title: `AI Agent — Create / Overwrite File`,
          detail: [
            `File:  ${path}`,
            `Lines: ${lines}`,
            "",
            "Preview:",
            content.slice(0, 600),
          ].join("\n"),
        };
      }
      case "edit_file": {
        const path = toolInput.path as string || "unknown";
        const oldText = toolInput.old_text as string || "";
        const newText = toolInput.new_text as string || "";
        return {
          title: `AI Agent — Edit File: ${path}`,
          detail: [
            "Find:",
            oldText.slice(0, 400),
            "",
            "Replace with:",
            newText.slice(0, 400),
          ].join("\n"),
        };
      }
      case "run_terminal": {
        const cmd = toolInput.command as string || "";
        const cwd = toolInput.cwd as string;
        return {
          title: `AI Agent — Run Command`,
          detail: [
            `$ ${cmd}`,
            ...(cwd ? [`Directory: ${cwd}`] : []),
          ].join("\n"),
        };
      }
      default:
        return {
          title: `AI Agent — ${toolName}`,
          detail: JSON.stringify(toolInput, null, 2).slice(0, 500),
        };
    }
  }
}
