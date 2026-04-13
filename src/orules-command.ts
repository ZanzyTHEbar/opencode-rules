import type { RuleRegistryEntry } from './rule-registry.js';
import {
  formatConditionSummary,
  hasConditions,
} from './rule-metadata-display.js';
import {
  summarizeRuleActivationLabel,
  summarizeRuleSources,
  type ActiveRule,
} from './rule-selection.js';

export interface ParsedOrulesCommand {
  subcommand: string;
  args: string[];
}

export function parseOrulesCommand(argumentsText: string): ParsedOrulesCommand {
  const parts = argumentsText.trim().split(/\s+/).filter(Boolean);

  return {
    subcommand: parts[0] ?? 'help',
    args: parts.slice(1),
  };
}

export function formatOrulesHelp(): string {
  return [
    '# OpenCode Rules',
    '',
    'Commands:',
    '- /orules list [query] — list discovered rules',
    '- /orules active — show active rules for this session',
    '- /orules show <rule> — show one rule and its content',
    '- /orules activate <rule...> — pin rules for this session',
    '- /orules deactivate <rule...> — unpin rules for this session',
    '- /orules clear — clear all pinned rules for this session',
    '',
    'Inline refs:',
    '- [[orule:<rule-id>]] — include a rule for the next turn only',
  ].join('\n');
}

function formatAliases(entry: RuleRegistryEntry): string | undefined {
  return entry.aliases.length > 0
    ? `aliases: ${entry.aliases.join(', ')}`
    : undefined;
}

export function formatRuleList(
  entries: RuleRegistryEntry[],
  options: {
    query?: string;
    activeRuleIDs?: Set<string>;
    pinnedRuleIDs?: Set<string>;
  } = {}
): string {
  const header = options.query
    ? `# OpenCode Rules\n\n${entries.length} rule(s) matching "${options.query}"`
    : `# OpenCode Rules\n\n${entries.length} discovered rule(s)`;

  if (entries.length === 0) {
    return header;
  }

  const lines = entries.map(entry => {
    const annotations: string[] = [];
    if (options.activeRuleIDs?.has(entry.ruleId)) {
      annotations.push('active');
    }
    if (options.pinnedRuleIDs?.has(entry.ruleId)) {
      annotations.push('pinned');
    }
    const aliasText = formatAliases(entry);
    if (aliasText) {
      annotations.push(aliasText);
    }
    return `- ${entry.ruleId}${annotations.length > 0 ? ` (${annotations.join('; ')})` : ''}`;
  });

  return [header, ...lines].join('\n');
}

export function formatRuleDetails(
  entry: RuleRegistryEntry,
  activeRule?: Pick<ActiveRule, 'sources'>
): string {
  const details: string[] = [
    `# OpenCode Rule: ${entry.ruleId}`,
    '',
    `Path: ${entry.relativePath}`,
  ];

  if (entry.aliases.length > 0) {
    details.push(`Aliases: ${entry.aliases.join(', ')}`);
  }

  if (activeRule) {
    details.push(`Active: yes (${summarizeRuleSources(activeRule.sources)})`);
  } else {
    details.push('Active: no');
  }

  if (hasConditions(entry.metadata)) {
    details.push(`Conditions: ${formatConditionSummary(entry.metadata)}`);
  } else {
    details.push('Conditions: always active');
  }

  details.push('', 'Content:', entry.content);
  return details.join('\n');
}

export function formatActiveRules(activeRules: ActiveRule[]): string {
  if (activeRules.length === 0) {
    return '# OpenCode Rules\n\nNo active rules for this session.';
  }

  const lines = activeRules.map(rule => {
    const label = summarizeRuleActivationLabel(rule.sources);
    return `- ${rule.ruleId}${label ? ` (${label})` : ''}`;
  });

  return [
    '# OpenCode Rules',
    '',
    `${activeRules.length} active rule(s) for this session:`,
    ...lines,
  ].join('\n');
}

export function formatResolutionProblems(
  missing: string[],
  ambiguous: Array<{ query: string; matches: RuleRegistryEntry[] }>
): string | undefined {
  const blocks: string[] = [];

  if (missing.length > 0) {
    blocks.push(
      ['Not found:', ...missing.map(query => `- ${query}`)].join('\n')
    );
  }

  if (ambiguous.length > 0) {
    for (const item of ambiguous) {
      blocks.push(
        [
          `Ambiguous: ${item.query}`,
          ...item.matches.map(match => `- ${match.ruleId}`),
        ].join('\n')
      );
    }
  }

  return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}
