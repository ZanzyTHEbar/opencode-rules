// tui/data/rules.ts
import { discoverRuleFiles } from '../../src/rule-discovery.js';
import type { RuleMetadata } from '../../src/rule-metadata.js';
import {
  formatConditionSummary,
  hasConditions,
} from '../../src/rule-metadata-display.js';
import { readActiveRulesState } from '../../src/active-rules-state.js';
import { RuleRegistry } from '../../src/rule-registry.js';
import { summarizeRuleActivationLabel } from '../../src/rule-selection.js';
import path from 'path';

export { formatConditionSummary, hasConditions };

/** Represents a rule as displayed in the sidebar */
export interface SidebarRuleEntry {
  /** Display name (filename stem, disambiguated if needed) */
  name: string;
  /** Canonical rule ID used by commands and inline refs */
  ruleId: string;
  /** Relative file path from the rules directory root */
  path: string;
  /** Optional aliases defined for the rule */
  aliases: string[];
  /** Whether this rule came from global or project-local rules dir */
  source: 'global' | 'project';
  /** Whether the rule has any conditional metadata */
  isConditional: boolean;
  /** Human-readable condition summary */
  conditionSummary: string;
  /** Full metadata for expanded view */
  metadata: RuleMetadata;
  /**
   * Active state of the rule.
   * - true: rule is active (matched by evaluation or unconditional without state file)
   * - false: rule is not active (not matched by evaluation)
   * - null: state not yet determined (conditional rule without state file)
   */
  isActive: boolean | null;
  /** Summary label for how the rule became active */
  activationLabel?: string;
  /** Raw activation sources when evaluation state is available */
  activationSources?: Array<'automatic' | 'manual-inline' | 'manual-pinned'>;
}

export interface LoadSidebarRulesResult {
  rules: SidebarRuleEntry[];
  skippedCount: number;
  /** Whether active rules state was successfully read from disk */
  hasEvaluationState: boolean;
}

/**
 * Load all discovered rules formatted for sidebar display.
 * Reuses discoverRuleFiles/getCachedRule from the server plugin.
 *
 * @param projectDir - Project directory or null (global rules only)
 * @param sessionId - Optional session ID to read active rules state
 */
export async function loadSidebarRules(
  projectDir: string | null,
  sessionId?: string
): Promise<LoadSidebarRulesResult> {
  // discoverRuleFiles accepts string | undefined, not null
  const discovered = await discoverRuleFiles(projectDir ?? undefined);
  const registry = new RuleRegistry(discovered);
  const registryEntries = await registry.listEntries();

  // Read active rules state if sessionId provided
  const activeState = sessionId ? await readActiveRulesState(sessionId) : null;
  const hasEvaluationState = activeState !== null;
  const matchedPathsSet = hasEvaluationState
    ? new Set(activeState.matchedRulePaths)
    : null;
  const activeRulesByPath = new Map(
    (activeState?.activeRules ?? []).map(rule => [rule.filePath, rule])
  );

  const entries: SidebarRuleEntry[] = [];
  const skippedCount = Math.max(discovered.length - registryEntries.length, 0);

  for (const rule of registryEntries) {
    const meta = rule.metadata;
    const source = ruleSource(rule.filePath, projectDir);
    const isConditional = hasConditions(meta);
    const conditionSummary = isConditional
      ? formatConditionSummary(meta)
      : 'always active';
    const activeRule = activeRulesByPath.get(rule.filePath);
    const activationLabel = activeRule
      ? summarizeRuleActivationLabel(activeRule.sources)
      : undefined;

    // Determine isActive based on state file or fallback logic
    let isActive: boolean | null;
    if (matchedPathsSet !== null) {
      // With state file: check if this rule's absolute path is in matchedPaths
      isActive = matchedPathsSet.has(rule.filePath) || Boolean(activeRule);
    } else {
      // Without state file: unconditional = true, conditional = null
      isActive = isConditional ? null : true;
    }

    entries.push({
      name: '', // placeholder — set in disambiguation pass
      ruleId: rule.ruleId,
      path: rule.relativePath,
      aliases: rule.aliases,
      source,
      isConditional,
      conditionSummary,
      metadata: meta,
      isActive,
      ...(activeRule
        ? {
            ...(activationLabel ? { activationLabel } : {}),
            activationSources: activeRule.sources,
          }
        : {}),
    });
  }

  disambiguateNames(entries);

  // Sort: project first, then global. Active rules to top, then alpha by name.
  const activeOrder = (v: boolean | null): number =>
    v === true ? 0 : v === null ? 1 : 2;
  entries.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'project' ? -1 : 1;
    const activeCmp = activeOrder(a.isActive) - activeOrder(b.isActive);
    if (activeCmp !== 0) return activeCmp;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.path.localeCompare(b.path);
  });

  return { rules: entries, skippedCount, hasEvaluationState };
}

/**
 * Determine if a rule file is project-local or global.
 * Uses path.sep boundary check to avoid matching partial prefixes
 * (e.g., /project/.opencode/rules-extra/ should not match).
 */
export function ruleSource(
  filePath: string,
  projectDir: string | null
): 'global' | 'project' {
  if (!projectDir) return 'global';
  const projectRulesPrefix =
    path.join(projectDir, '.opencode', 'rules') + path.sep;
  return filePath.startsWith(projectRulesPrefix) ? 'project' : 'global';
}

/**
 * Three-pass name disambiguation.
 * Pass 1: Extract filename stem from each entry's path.
 * Pass 2: For duplicate stems, prefix with parent directory.
 * Pass 3: If still ambiguous (same parent or root-level), use full relative
 *         path (including extension) as the display name.
 *
 * Mutates entries[].name in place.
 */
export function disambiguateNames(entries: SidebarRuleEntry[]): void {
  // Pass 1: assign stem names (filename without extension, using last dot)
  for (const entry of entries) {
    const basename = path.basename(entry.path);
    const dotIndex = basename.lastIndexOf('.');
    entry.name = dotIndex > 0 ? basename.substring(0, dotIndex) : basename;
  }

  // Pass 2: detect and resolve collisions with parent directory prefix
  const stemCounts = new Map<string, number>();
  for (const entry of entries) {
    stemCounts.set(entry.name, (stemCounts.get(entry.name) ?? 0) + 1);
  }

  for (const entry of entries) {
    if ((stemCounts.get(entry.name) ?? 0) <= 1) continue;

    const dir = path.dirname(entry.path);
    if (dir && dir !== '.') {
      const parent = path.basename(dir);
      entry.name = `${parent}/${entry.name}`;
    }
  }

  // Pass 3: if still ambiguous, use full relative path WITH extension
  const nameCounts = new Map<string, number>();
  for (const entry of entries) {
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  }

  for (const entry of entries) {
    if ((nameCounts.get(entry.name) ?? 0) > 1) {
      entry.name = entry.path;
    }
  }
}
