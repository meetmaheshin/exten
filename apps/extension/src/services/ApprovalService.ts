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

    const detail = this.formatDetail(toolName, toolInput);
    const label = this.toolLabel(toolName);

    const result = await vscode.window.showWarningMessage(
      `Claude wants to: ${label}`,
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

  private toolLabel(toolName: string): string {
    switch (toolName) {
      case "write_file":
        return "Write a file";
      case "edit_file":
        return "Edit a file";
      case "run_terminal":
        return "Run a terminal command";
      default:
        return toolName;
    }
  }

  private formatDetail(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
      case "write_file":
        return `Create/overwrite: ${toolInput.path}\n\nContent preview:\n${(toolInput.content as string || "").slice(0, 500)}`;
      case "edit_file":
        return `File: ${toolInput.path}\n\nReplace:\n${(toolInput.old_text as string || "").slice(0, 300)}\n\nWith:\n${(toolInput.new_text as string || "").slice(0, 300)}`;
      case "run_terminal":
        return `Command: ${toolInput.command}\n${toolInput.cwd ? `Directory: ${toolInput.cwd}` : ""}`;
      default:
        return JSON.stringify(toolInput, null, 2).slice(0, 500);
    }
  }
}
