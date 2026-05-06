import { useState } from "react";

export type ChecklistItemId =
  | "openChat"        // user has opened the chat (always true once they see this)
  | "firstMessage"    // sent any message
  | "trySlash"        // used a slash command
  | "tryAt"           // used an @-mention
  | "tryPlan"         // toggled plan mode at least once
  | "tryAgentType"    // switched agent type away from coder
  | "openRules";      // opened the project rules file

export interface ChecklistState {
  /** Items the user has completed at least once. Persists across sessions. */
  completed: ChecklistItemId[];
  /** True when the user has dismissed the checklist (persists). */
  dismissed: boolean;
}

interface ItemDef {
  id: ChecklistItemId;
  title: string;
  hint: string;
}

const ITEMS: ItemDef[] = [
  {
    id: "openChat",
    title: "Open the chat",
    hint: "You're here — tick! 🎉",
  },
  {
    id: "firstMessage",
    title: "Send your first message",
    hint: "Ask the agent to read a file: \"What's in package.json?\"",
  },
  {
    id: "trySlash",
    title: "Try a slash command",
    hint: "Type `/` to see the picker. Try `/help` or `/cost`.",
  },
  {
    id: "tryAt",
    title: "Mention a file with @",
    hint: "Type `@` in the input — fuzzy-match files anywhere in the workspace.",
  },
  {
    id: "tryPlan",
    title: "Try plan mode",
    hint: "Click 📝 Plan: OFF to switch to read-only planning. The agent proposes a plan you approve before it touches files.",
  },
  {
    id: "tryAgentType",
    title: "Switch agent type",
    hint: "Use 🔍 QA to find bugs, or 🎨 Design for UI review.",
  },
  {
    id: "openRules",
    title: "Set up project rules",
    hint: "Run `Ailancers: Open Project Rules` from the Cmd Palette to write team-shared agent guidance.",
  },
];

interface Props {
  state: ChecklistState;
  /** True when the user has the `hideOnboarding` setting on. We hide the
   *  checklist entirely without dispatching `dismiss` — flipping the setting
   *  back off should bring the checklist back. */
  hidden: boolean;
  onDismiss: () => void;
}

export function OnboardingChecklist({ state, hidden, onDismiss }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (hidden) return null;
  if (state.dismissed) return null;
  // Auto-hide when everything's done.
  const allDone = ITEMS.every((i) => state.completed.includes(i.id));
  if (allDone) return null;

  const doneCount = state.completed.length;

  return (
    <div className="onboarding-checklist" role="region" aria-label="Onboarding checklist">
      <div className="onboarding-header-row">
        <button
          type="button"
          className="onboarding-header"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="onboarding-icon">🎓</span>
          <span className="onboarding-title">
            Get started with Ailancers
          </span>
          <span className="onboarding-progress">
            {doneCount}/{ITEMS.length}
          </span>
          <span className={`onboarding-chevron ${collapsed ? "" : "open"}`}>▶</span>
        </button>
        <button
          type="button"
          className="onboarding-dismiss"
          onClick={onDismiss}
          title="Dismiss the checklist (re-open via the hideOnboarding setting)"
          aria-label="Dismiss onboarding checklist"
        >×</button>
      </div>
      {!collapsed && (
        <ul className="onboarding-items">
          {ITEMS.map((item) => {
            const done = state.completed.includes(item.id);
            return (
              <li key={item.id} className={`onboarding-item ${done ? "done" : ""}`}>
                <span className="onboarding-checkbox" aria-hidden="true">
                  {done ? "✓" : "○"}
                </span>
                <div className="onboarding-item-body">
                  <div className="onboarding-item-title">{item.title}</div>
                  {!done && <div className="onboarding-item-hint">{item.hint}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Helper: which checklist item, if any, was just completed by this state
 *  transition. The App calls this after every relevant action and dispatches
 *  a single MARK_CHECKLIST action if the result is non-null. */
export function detectChecklistCompletion(args: {
  prevCompleted: ChecklistItemId[];
  hasMessages: boolean;
  ranSlashCommand: boolean;
  sentAtMention: boolean;
  toggledPlanMode: boolean;
  switchedAgentType: boolean;
}): ChecklistItemId | null {
  const has = (id: ChecklistItemId) => args.prevCompleted.includes(id);
  if (!has("firstMessage") && args.hasMessages) return "firstMessage";
  if (!has("trySlash") && args.ranSlashCommand) return "trySlash";
  if (!has("tryAt") && args.sentAtMention) return "tryAt";
  if (!has("tryPlan") && args.toggledPlanMode) return "tryPlan";
  if (!has("tryAgentType") && args.switchedAgentType) return "tryAgentType";
  return null;
}
