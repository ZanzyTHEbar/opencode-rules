import { describe, it, expect } from 'vitest';
import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
} from './test-fixtures.js';
import { RuleRegistry } from './rule-registry.js';

describe('rule-registry', () => {
  beforeEachRegistry();
  afterEachRegistry();

  it('resolves aliases and canonical ids', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'security.mdc');
    writeFileSync(
      rulePath,
      `---\naliases:\n  - secure\n---\nUse security review steps.`
    );

    const registry = new RuleRegistry([
      { filePath: rulePath, relativePath: 'security.mdc' },
    ]);

    await expect(registry.resolve('security')).resolves.toMatchObject({
      entry: expect.objectContaining({ ruleId: 'security' }),
    });
    await expect(registry.resolve('secure')).resolves.toMatchObject({
      entry: expect.objectContaining({ ruleId: 'security' }),
    });
  });

  it('treats stripped relative-path collisions as ambiguous across scopes', async () => {
    const { globalRulesDir, projectRulesDir } = getTestDirs();
    const globalPath = path.join(globalRulesDir, 'shared.mdc');
    const projectPath = path.join(projectRulesDir, 'shared.mdc');
    writeFileSync(globalPath, 'Global shared rule');
    writeFileSync(projectPath, 'Project shared rule');

    const registry = new RuleRegistry([
      { filePath: globalPath, relativePath: 'shared.mdc' },
      { filePath: projectPath, relativePath: 'shared.mdc' },
    ]);

    const result = await registry.resolve('shared');
    expect(result.reason).toBe('ambiguous');
    expect(result.matches).toHaveLength(2);
  });

  it('completes scoped ids containing colons', async () => {
    const { globalRulesDir, projectRulesDir } = getTestDirs();
    mkdirSync(path.join(globalRulesDir, 'frontend'), { recursive: true });
    const globalPath = path.join(globalRulesDir, 'frontend', 'react.mdc');
    const projectPath = path.join(projectRulesDir, 'frontend', 'react.mdc');
    mkdirSync(path.dirname(projectPath), { recursive: true });
    writeFileSync(globalPath, 'Global react rule');
    writeFileSync(projectPath, 'Project react rule');

    const registry = new RuleRegistry([
      { filePath: globalPath, relativePath: 'frontend/react.mdc' },
      { filePath: projectPath, relativePath: 'frontend/react.mdc' },
    ]);

    const completions = await registry.completePrefix('project:front');
    expect(completions).toContain('project:frontend/react');
  });

  it('deduplicates completion candidates by resolved rule', async () => {
    const { globalRulesDir } = getTestDirs();
    const rulePath = path.join(globalRulesDir, 'security-review.mdc');
    writeFileSync(
      rulePath,
      `---\naliases:\n  - security-rev\n---\nUse security review guidance.`
    );

    const registry = new RuleRegistry([
      { filePath: rulePath, relativePath: 'security-review.mdc' },
    ]);

    await expect(registry.completePrefix('security-re')).resolves.toEqual([
      'security-review',
    ]);
  });
});

function beforeEachRegistry(): void {
  beforeEach(() => {
    setupTestDirs();
  });
}

function afterEachRegistry(): void {
  afterEach(() => {
    teardownTestDirs();
  });
}
