# Design: add-manual-rule-controls

## Context

`opencode-rules` already discovers markdown rule files, evaluates automatic filters, and injects matched rule text through `experimental.chat.system.transform`. The new feature set adds a user control surface on top of that existing pipeline without introducing a second injection path.

The implementation must align with the modern OpenCode plugin pattern established by DCP:

- plugin commands are registered through `config.command`
- plugin commands are handled in `command.execute.before`
- message text can be rewritten in `experimental.chat.messages.transform`
- system prompt injection remains centralized in `experimental.chat.system.transform`

## Goals

- Let users reference rules explicitly from a normal chat turn.
- Let users inspect and pin rules from a stable plugin command family.
- Preserve a single rule injection path so automatic and manual rules are deduped and formatted consistently.
- Persist activation provenance for TUI and command reporting.
- Add lightweight completion for rule references.

## Non-Goals

- No per-rule slash command registration.
- No arbitrary expression language for rule references.
- No fuzzy auto-selection that injects ambiguous rules.
- No new persistence store beyond the existing session store and active-rules state file.

## Decisions

### 1. Canonical rule IDs come from discovered relative paths

Each discovered rule receives a canonical ID derived from its relative path without extension. If that ID collides across scopes, the registry prefixes the scope (`global:` or `project:`). Optional `aliases` from frontmatter provide convenience names but are never authoritative when ambiguous.

### 2. Inline refs are parsed in `experimental.chat.messages.transform`

The plugin parses `[[orule:<reference>]]` tokens from the latest non-ignored, non-synthetic user text part. The transform:

- strips the control token before the model sees the user prompt
- queues the referenced rules in session state for the next evaluation
- leaves actual rule formatting and injection to `experimental.chat.system.transform`

This keeps manual selection and automatic selection on the same path.

### 3. Session-pinned rules live in session state

The session store tracks:

- `manualPinnedRuleIDs`
- `pendingInlineRuleIDs`
- `lastProcessedInlineMessageID`

Pinned rules survive across turns until `/orules deactivate` or `/orules clear`. Inline refs are one-turn only and are cleared after evaluation.

### 4. `/orules` is a single namespaced command family

The plugin registers one command, `/orules`, and handles these subcommands entirely in the plugin:

- `help`
- `list [query]`
- `active`
- `show <rule>`
- `activate <rule...>`
- `deactivate <rule...>`
- `clear`

Responses are emitted as ignored `noReply` session messages so state/reporting commands do not require a model turn.

### 5. Active rule state records provenance

The persisted active-rules state continues to include `matchedRulePaths` for backward compatibility and may also include structured `activeRules` records with activation sources:

- `automatic`
- `manual-inline`
- `manual-pinned`

This supports the TUI sidebar, `/orules active`, and future tooling without re-reading raw prompt text.

### 6. Completion is suffix-only and conservative

`experimental.text.complete` is used as a suffix completion hook, not an IDE-style suggestion API. The plugin only appends text when the current prefix resolves to exactly one rule candidate for:

- `[[orule:...`
- `/orules show ...`
- `/orules activate ...`
- `/orules deactivate ...`

## Risks / Trade-offs

- Inline refs currently ignore unresolved references instead of surfacing a warning during a normal chat turn.
- Canonical IDs are stable and simple, but users may still prefer aliases for long paths.
- The active-rules state file now has a richer optional schema, so consumers must tolerate both legacy and enriched shapes.

## Validation

- Runtime, registry, parser, completion, and sidebar tests cover the feature set.
- `npm run build` and `npm run test:run` pass in the current worktree.
- The `openspec` CLI is not available in this environment, so change validation must be completed later with `openspec validate add-manual-rule-controls --strict`.
