import { getCachedRule, type DiscoveredRule } from './rule-discovery.js';
import type { RuleMetadata } from './rule-metadata.js';

export interface RuleRegistryEntry {
  filePath: string;
  relativePath: string;
  ruleId: string;
  scope: 'global' | 'project';
  aliases: string[];
  metadata: RuleMetadata;
  content: string;
}

export interface RuleResolutionResult {
  query: string;
  entry?: RuleRegistryEntry;
  reason?: 'missing' | 'ambiguous';
  matches?: RuleRegistryEntry[];
}

export interface ResolveManyResult {
  resolved: RuleRegistryEntry[];
  missing: string[];
  ambiguous: Array<{ query: string; matches: RuleRegistryEntry[] }>;
}

function normalizeRulePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripRuleExtension(value: string): string {
  if (value.endsWith('.mdc')) {
    return value.slice(0, -4);
  }
  if (value.endsWith('.md')) {
    return value.slice(0, -3);
  }
  return value;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function inferRuleScope(filePath: string): 'global' | 'project' {
  return filePath.includes('/.opencode/rules/') ? 'project' : 'global';
}

export function buildCanonicalRuleIdMap(
  files: DiscoveredRule[]
): Map<string, string> {
  const normalizedFiles = files.map(file => ({
    filePath: file.filePath,
    relativePath: normalizeRulePath(file.relativePath),
    scope: inferRuleScope(normalizeRulePath(file.filePath)),
  }));
  const baseCounts = new Map<string, number>();
  const scopedCounts = new Map<string, number>();

  for (const { relativePath, scope } of normalizedFiles) {
    const baseId = stripRuleExtension(relativePath);
    baseCounts.set(baseId, (baseCounts.get(baseId) ?? 0) + 1);
    const scopedId = `${scope}:${baseId}`;
    scopedCounts.set(scopedId, (scopedCounts.get(scopedId) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const { filePath, relativePath, scope } of normalizedFiles) {
    const baseId = stripRuleExtension(relativePath);
    const scopedId = `${scope}:${baseId}`;

    let ruleId = baseId;
    if ((baseCounts.get(baseId) ?? 0) > 1) {
      ruleId =
        (scopedCounts.get(scopedId) ?? 0) > 1
          ? `${scope}:${relativePath}`
          : scopedId;
    }

    result.set(filePath, ruleId);
  }

  return result;
}

function normalizeReference(reference: string): string {
  return normalizeRulePath(reference.trim());
}

export class RuleRegistry {
  private readonly ruleIdMap: Map<string, string>;

  constructor(private readonly files: DiscoveredRule[]) {
    this.ruleIdMap = buildCanonicalRuleIdMap(files);
  }

  async listEntries(): Promise<RuleRegistryEntry[]> {
    const entries = await Promise.all(
      this.files.map(async file => {
        const cached = await getCachedRule(file.filePath);
        if (!cached) {
          return null;
        }

        const relativePath = normalizeRulePath(file.relativePath);
        return {
          filePath: file.filePath,
          relativePath,
          ruleId:
            this.ruleIdMap.get(file.filePath) ??
            stripRuleExtension(relativePath),
          scope: inferRuleScope(normalizeRulePath(file.filePath)),
          aliases: uniqueStrings(cached.metadata?.aliases ?? []),
          metadata: cached.metadata ?? {},
          content: cached.strippedContent,
        } satisfies RuleRegistryEntry;
      })
    );

    return entries
      .filter((entry): entry is RuleRegistryEntry => entry !== null)
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  }

  async resolve(reference: string): Promise<RuleResolutionResult> {
    const normalizedReference = normalizeReference(reference);
    if (!normalizedReference) {
      return { query: reference, reason: 'missing' };
    }

    const entries = await this.listEntries();
    const byRuleId = new Map(entries.map(entry => [entry.ruleId, entry]));
    const byRelativePath = new Map<string, RuleRegistryEntry[]>();
    const byStrippedRelativePath = new Map<string, RuleRegistryEntry[]>();
    const aliasMap = new Map<string, RuleRegistryEntry[]>();

    for (const entry of entries) {
      const matches = byRelativePath.get(entry.relativePath) ?? [];
      matches.push(entry);
      byRelativePath.set(entry.relativePath, matches);

      const strippedMatches =
        byStrippedRelativePath.get(stripRuleExtension(entry.relativePath)) ??
        [];
      strippedMatches.push(entry);
      byStrippedRelativePath.set(
        stripRuleExtension(entry.relativePath),
        strippedMatches
      );
    }

    for (const entry of entries) {
      for (const alias of entry.aliases) {
        const normalizedAlias = normalizeReference(alias);
        const existing = aliasMap.get(normalizedAlias) ?? [];
        existing.push(entry);
        aliasMap.set(normalizedAlias, existing);
      }
    }

    const directMatch = byRuleId.get(normalizedReference);
    if (directMatch) {
      return { query: reference, entry: directMatch };
    }

    const relativePathMatches = byRelativePath.get(normalizedReference) ?? [];
    if (relativePathMatches.length === 1) {
      return { query: reference, entry: relativePathMatches[0] };
    }
    if (relativePathMatches.length > 1) {
      return {
        query: reference,
        reason: 'ambiguous',
        matches: relativePathMatches,
      };
    }

    const strippedReference = stripRuleExtension(normalizedReference);
    if (strippedReference !== normalizedReference) {
      const strippedMatch = byRuleId.get(strippedReference);
      if (strippedMatch) {
        return { query: reference, entry: strippedMatch };
      }
    }

    const strippedRelativeMatches =
      byStrippedRelativePath.get(strippedReference) ?? [];
    if (strippedRelativeMatches.length === 1) {
      return { query: reference, entry: strippedRelativeMatches[0] };
    }
    if (strippedRelativeMatches.length > 1) {
      return {
        query: reference,
        reason: 'ambiguous',
        matches: strippedRelativeMatches,
      };
    }

    const aliasMatches =
      aliasMap.get(normalizedReference) ??
      (strippedReference !== normalizedReference
        ? aliasMap.get(strippedReference)
        : undefined) ??
      [];

    if (aliasMatches.length === 1) {
      return { query: reference, entry: aliasMatches[0] };
    }

    if (aliasMatches.length > 1) {
      return { query: reference, reason: 'ambiguous', matches: aliasMatches };
    }

    return { query: reference, reason: 'missing' };
  }

  async resolveMany(references: string[]): Promise<ResolveManyResult> {
    const resolved = new Map<string, RuleRegistryEntry>();
    const missing: string[] = [];
    const ambiguous: Array<{ query: string; matches: RuleRegistryEntry[] }> =
      [];

    for (const reference of references) {
      const result = await this.resolve(reference);
      if (result.entry) {
        resolved.set(result.entry.ruleId, result.entry);
      } else if (result.reason === 'ambiguous' && result.matches) {
        ambiguous.push({ query: reference, matches: result.matches });
      } else {
        missing.push(reference);
      }
    }

    return {
      resolved: Array.from(resolved.values()),
      missing,
      ambiguous,
    };
  }

  async search(query?: string): Promise<RuleRegistryEntry[]> {
    const entries = await this.listEntries();
    const normalizedQuery = query?.trim().toLowerCase();
    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter(entry => {
      if (entry.ruleId.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      return entry.aliases.some(alias =>
        alias.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  async completePrefix(prefix: string): Promise<string[]> {
    const entries = await this.listEntries();
    const normalizedPrefix = normalizeReference(prefix);
    const matchedEntries = new Map<string, RuleRegistryEntry>();

    for (const entry of entries) {
      if (entry.ruleId.startsWith(normalizedPrefix)) {
        matchedEntries.set(entry.ruleId, entry);
        continue;
      }

      if (entry.aliases.some(alias => alias.startsWith(normalizedPrefix))) {
        matchedEntries.set(entry.ruleId, entry);
      }
    }

    return Array.from(matchedEntries.values())
      .map(entry => entry.ruleId)
      .sort((a, b) => a.localeCompare(b));
  }
}
