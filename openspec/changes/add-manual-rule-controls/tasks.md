# Tasks: add-manual-rule-controls

## 1. Rule identity and manual selection

- [x] 1.1 Add canonical rule IDs and optional `aliases` parsing.
- [x] 1.2 Add a rule registry for manual resolution, search, and completion.
- [x] 1.3 Add inline `[[orule:...]]` parsing and one-turn pending rule state.
- [x] 1.4 Merge automatic, pinned, and inline rule selections before system prompt injection.

## 2. Command, persistence, and TUI behavior

- [x] 2.1 Register `/orules` through plugin config and handle the command family in `command.execute.before`.
- [x] 2.2 Persist provenance-rich active rule state while keeping `matchedRulePaths` compatibility.
- [x] 2.3 Surface rule IDs, aliases, and activation provenance in the TUI sidebar.
- [x] 2.4 Add rule reference completion through `experimental.text.complete`.

## 3. Validation and documentation

- [x] 3.1 Add and update tests for inline refs, registry resolution, command behavior, persisted provenance, completion, and TUI state mapping.
- [x] 3.2 Validate implementation with `npm run build` and `npm run test:run`.
- [x] 3.3 Update README and docs for aliases, inline refs, `/orules`, provenance, and completion behavior.
- [x] 3.4 Manually verify OpenSpec artifact structure in this environment (`openspec` CLI unavailable locally).
