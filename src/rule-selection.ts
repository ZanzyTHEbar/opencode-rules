import type {
  ActiveRuleRecord,
  ActiveRuleSource,
} from './active-rules-state.js';
import { formatRulesForPrompt, type MatchedRule } from './rule-filter.js';

export interface ActiveRule extends ActiveRuleRecord {
  content: string;
}

export function mergeRuleSelections(
  selections: Array<{
    source: ActiveRuleSource;
    rules: MatchedRule[];
  }>
): ActiveRule[] {
  const merged = new Map<string, ActiveRule>();

  for (const selection of selections) {
    for (const rule of selection.rules) {
      const existing = merged.get(rule.ruleId);
      if (existing) {
        if (!existing.sources.includes(selection.source)) {
          existing.sources.push(selection.source);
        }
        continue;
      }

      merged.set(rule.ruleId, {
        ruleId: rule.ruleId,
        filePath: rule.filePath,
        relativePath: rule.relativePath,
        sources: [selection.source],
        content: rule.content,
      });
    }
  }

  return Array.from(merged.values());
}

export function formatMergedRulesForPrompt(rules: ActiveRule[]): string {
  return formatRulesForPrompt(rules);
}

export function summarizeRuleSources(sources: ActiveRuleSource[]): string {
  const orderedSources: ActiveRuleSource[] = [
    'automatic',
    'manual-pinned',
    'manual-inline',
  ];

  return orderedSources.filter(source => sources.includes(source)).join(', ');
}

export function summarizeRuleActivationLabel(
  sources: ActiveRuleSource[]
): string | undefined {
  if (sources.length === 0) {
    return undefined;
  }

  const hasAutomatic = sources.includes('automatic');
  const hasManual = sources.some(source => source !== 'automatic');

  if (hasAutomatic && hasManual) {
    return 'auto+manual';
  }

  if (hasManual) {
    return 'manual';
  }

  return 'auto';
}
