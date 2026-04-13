import type { RuleMetadata } from './rule-metadata.js';

export function hasConditions(meta: RuleMetadata | undefined): boolean {
  if (!meta) return false;
  return !!(
    meta.globs ||
    meta.keywords ||
    meta.tools ||
    meta.model ||
    meta.agent ||
    meta.command ||
    meta.project ||
    meta.branch ||
    meta.os ||
    meta.ci !== undefined
  );
}

export function formatConditionSummary(meta: RuleMetadata): string {
  const parts: string[] = [];

  const arrayFields: Array<[keyof RuleMetadata, string]> = [
    ['globs', 'globs'],
    ['keywords', 'keywords'],
    ['tools', 'tools'],
    ['model', 'model'],
    ['agent', 'agent'],
    ['command', 'command'],
    ['project', 'project'],
    ['branch', 'branch'],
    ['os', 'os'],
  ];

  for (const [field, label] of arrayFields) {
    const value = meta[field];
    if (Array.isArray(value) && value.length > 0) {
      parts.push(`${label}: ${(value as string[]).join(', ')}`);
    }
  }

  if (meta.ci !== undefined) {
    parts.push(`ci: ${String(meta.ci)}`);
  }

  if (meta.match) {
    parts.push(`match: ${meta.match}`);
  }

  return parts.join(', ');
}
