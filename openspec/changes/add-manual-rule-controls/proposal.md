# Proposal: add-manual-rule-controls

## Why

Automatic rule matching covers many cases, but users also need a direct way to pull a known rule into a chat, inspect which rules are active, and pin rules for the rest of a session. The plugin also needs a stable naming and completion surface so manual rule controls are predictable instead of path-guessing.

## What Changes

- Add canonical rule IDs and optional `aliases` frontmatter for manual rule resolution.
- Add inline one-turn manual rule references with `[[orule:<rule-id>]]`.
- Add a plugin-managed `/orules` command family for listing, showing, activating, deactivating, and clearing manual rules.
- Persist active rule provenance so the TUI and command surface can distinguish automatic, inline-manual, and pinned-manual activation.
- Add rule reference completion for inline refs and supported `/orules` arguments.

## Impact

- Affected spec: `rule-discovery`
- Affected code:
  - `src/runtime.ts`
  - `src/rule-metadata.ts`
  - `src/rule-registry.ts`
  - `src/manual-rule-refs.ts`
  - `src/orules-command.ts`
  - `src/rule-selection.ts`
  - `src/text-completion.ts`
  - `src/active-rules-state.ts`
  - `src/session-store.ts`
  - `tui/data/rules.ts`
  - `tui/slots/sidebar-content.tsx`
- Affected docs:
  - `README.md`
  - `docs/rules.md`
  - `docs/compaction-handling.md`
- Related pending work:
  - `openspec/changes/add-rule-filter-framework/`
- Risk: Medium. This changes user-facing runtime behavior across command handling, message transforms, persisted active state, and the TUI sidebar, but it remains compatible with existing automatic rule filtering.
