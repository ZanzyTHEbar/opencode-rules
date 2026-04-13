# rule-discovery Spec Delta

## MODIFIED Requirements

### Requirement: Frontmatter Parsing

The system SHALL parse rule frontmatter using a YAML parser supporting standard YAML syntax including inline arrays, quoted strings, and multiline arrays. Recognized frontmatter keys are `aliases`, `globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`; key matching is case-sensitive. The `aliases` key SHALL be parsed as a string array when provided. The `ci` key SHALL be parsed as a boolean when provided. The `match` key SHALL accept `any` and `all`, and invalid or missing `match` values SHALL be treated as `any`. Unrecognized frontmatter keys SHALL be ignored.

#### Scenario: Inline array syntax for globs

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  globs: ['*.ts', '*.tsx']
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs array SHALL contain `["*.ts", "*.tsx"]`

#### Scenario: Mixed array syntax

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  keywords:
    - testing
    - 'unit test'
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the keywords array SHALL contain `["testing", "unit test"]`

#### Scenario: Aliases frontmatter field

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  aliases:
    - secure
    - security-review
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the aliases array SHALL contain `["secure", "security-review"]`

#### Scenario: Tools frontmatter field

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  tools:
    - 'mcp_github'
    - 'mcp_slack'
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the tools array SHALL contain `["mcp_github", "mcp_slack"]`

#### Scenario: Unrecognized frontmatter keys ignored

- **GIVEN** a rule file with frontmatter:
  ```yaml
  ---
  globs:
    - '*.md'
  author: someone
  ---
  ```
- **WHEN** the system parses the rule
- **THEN** the globs SHALL be extracted
- **AND** the `author` field SHALL be ignored

### Requirement: Message Context Extraction

The system SHALL use the `experimental.chat.messages.transform` hook to seed session context by extracting file paths from conversation message history and capturing the latest user prompt. History seeding SHALL occur once per session. The same hook SHALL also process the latest non-ignored, non-synthetic user text on each pass so inline `[[orule:...]]` references can be removed from the user-visible prompt while being queued for the next rule evaluation. This behavior is supplemented by real-time capture from `tool.execute.before` and `chat.message` hooks.

#### Scenario: Extract paths from tool call arguments

- **GIVEN** a message contains a tool call to `read` with path `/src/utils/helper.ts`
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `/src/utils/helper.ts` SHALL be extracted and stored in the session context

#### Scenario: Extract paths from message content

- **GIVEN** a user message contains text "please check the file src/index.ts"
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the path `src/index.ts` SHALL be extracted and stored in the session context

#### Scenario: Inline rule reference is stripped from latest user text

- **GIVEN** the latest user text contains `Please review [[orule:security/review]] now`
- **WHEN** the `experimental.chat.messages.transform` hook is triggered
- **THEN** the latest user text presented to subsequent processing SHALL become `Please review now`
- **AND** the referenced rule SHALL be queued for the next rule evaluation

#### Scenario: History seeding occurs once per session

- **GIVEN** a session has already been seeded from message history
- **WHEN** the `experimental.chat.messages.transform` hook fires again
- **THEN** the system SHALL skip re-extracting paths from history
- **AND** the `seededFromHistory` flag SHALL prevent redundant scanning

#### Scenario: Latest user prompt is captured after inline refs are removed

- **GIVEN** the latest user message contains inline rule references
- **WHEN** the `experimental.chat.messages.transform` hook runs
- **THEN** the stored latest user prompt SHALL reflect the stripped text

## ADDED Requirements

### Requirement: Rule Registry and Manual Resolution

The system SHALL assign each discovered rule a canonical rule identifier for manual resolution. By default, the canonical ID SHALL be the rule's relative path without extension. When that identifier would collide across scopes, the system SHALL disambiguate it with a scope prefix such as `global:` or `project:`. Rules MAY declare optional `aliases` in frontmatter. Manual resolution SHALL consider canonical IDs, relative paths, stripped relative paths, and aliases. Ambiguous references SHALL not resolve to a rule.

#### Scenario: Unique rule uses extensionless relative path as its canonical ID

- **GIVEN** a discovered rule at `security/review.mdc`
- **WHEN** the system builds the rule registry
- **THEN** the rule's canonical ID SHALL be `security/review`

#### Scenario: Global and project rules with the same path are scope-qualified

- **GIVEN** a global rule and a project rule both discovered at `frontend/react.mdc`
- **WHEN** the system builds canonical IDs
- **THEN** the rules SHALL be assigned distinct IDs with `global:` and `project:` prefixes

#### Scenario: Ambiguous alias does not resolve

- **GIVEN** two discovered rules both declare the alias `secure`
- **WHEN** a manual reference resolves `secure`
- **THEN** the reference SHALL be treated as ambiguous
- **AND** the system SHALL NOT choose one rule implicitly

### Requirement: Manual Rule Selection and Injection

The system SHALL support two forms of manual rule selection:

- one-turn inline references from `[[orule:<reference>]]`
- session-pinned rules managed through `/orules`

Manual selections SHALL bypass automatic filter matching, SHALL be merged with automatic matches before system prompt formatting, SHALL inject each active rule at most once per evaluation, and SHALL preserve activation provenance.

#### Scenario: Inline reference applies to the next evaluation only

- **GIVEN** the latest user prompt includes `[[orule:security/review]]`
- **WHEN** the next `experimental.chat.system.transform` evaluation runs
- **THEN** the referenced rule SHALL be included even if its automatic filters do not match
- **AND** the queued inline reference SHALL be cleared after that evaluation

#### Scenario: Pinned rule persists across turns until cleared

- **GIVEN** `/orules activate security/review` was executed for a session
- **WHEN** later turns are evaluated for that same session
- **THEN** the pinned rule SHALL remain active until `/orules deactivate` or `/orules clear` removes it

#### Scenario: Automatically matched and manually selected rule is injected once

- **GIVEN** a rule matches automatic filters
- **AND** the same rule is also manually selected for the session
- **WHEN** rules are merged for system prompt injection
- **THEN** the rule SHALL appear only once in the injected prompt
- **AND** the active rule provenance SHALL retain both activation sources

### Requirement: Rule Command Interface

The system SHALL register a plugin-managed `/orules` command family via plugin config and handle it in `command.execute.before`. The command family SHALL support `help`, `list`, `active`, `show`, `activate`, `deactivate`, and `clear`. Fully handled command responses SHALL be written back as ignored no-reply session messages.

#### Scenario: Listing discovered rules

- **GIVEN** discovered rules exist for the current session
- **WHEN** the user runs `/orules list`
- **THEN** the system SHALL respond with discovered rule IDs
- **AND** the response MAY annotate active and pinned rules

#### Scenario: Showing one rule by manual reference

- **GIVEN** a discovered rule resolves from `/orules show security/review`
- **WHEN** the command is handled
- **THEN** the response SHALL include the canonical rule ID, path, activation status, and content

#### Scenario: Activation command reports resolution problems without activating ambiguous rules

- **GIVEN** `/orules activate secure` resolves one missing reference and one ambiguous reference
- **WHEN** the command is handled
- **THEN** the response SHALL report missing and ambiguous references
- **AND** the system SHALL only pin rules that resolved uniquely

### Requirement: Active Rule State Persistence

After each session rule evaluation, the system SHALL persist active rule state to `~/.opencode/state/opencode-rules/{sessionId}.json`. The persisted state SHALL include `matchedRulePaths` for compatibility and MAY include structured `activeRules` records with `ruleId`, `filePath`, `relativePath`, and activation `sources`.

#### Scenario: Persisted state includes provenance-rich active rules

- **GIVEN** a session evaluation activates a rule automatically and via a manual inline selection
- **WHEN** the state file is written
- **THEN** the file SHALL still include `matchedRulePaths`
- **AND** the corresponding `activeRules` record SHALL include both activation sources

#### Scenario: State file records empty matches

- **GIVEN** no rules are active for a session evaluation
- **WHEN** the state file is written
- **THEN** `matchedRulePaths` SHALL be an empty array

### Requirement: Rule Reference Completion

The system SHALL support rule reference completion through `experimental.text.complete` for inline `[[orule:...` references and `/orules show|activate|deactivate` arguments. Completion SHALL append text only when the current prefix resolves to exactly one candidate.

#### Scenario: Unique inline prefix completes to a rule ID and closing token

- **GIVEN** the current text is `Use [[orule:security-rev`
- **AND** exactly one rule candidate matches that prefix
- **WHEN** text completion runs
- **THEN** the completion SHALL append the remaining suffix and closing `]]`

#### Scenario: Ambiguous command prefix does not complete

- **GIVEN** the current text is `/orules show sec`
- **AND** multiple rule candidates match the prefix `sec`
- **WHEN** text completion runs
- **THEN** the system SHALL NOT append a completion suffix
