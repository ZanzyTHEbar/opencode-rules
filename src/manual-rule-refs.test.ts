import { describe, it, expect } from 'vitest';
import {
  hasInlineRuleReference,
  parseInlineRuleReferences,
} from './manual-rule-refs.js';

describe('manual-rule-refs', () => {
  it('extracts and strips inline rule references', () => {
    const result = parseInlineRuleReferences(
      'Please review this [[orule:security/review]] now'
    );

    expect(result.references).toEqual(['security/review']);
    expect(result.strippedText).toBe('Please review this now');
  });

  it('deduplicates multiple references and trims whitespace', () => {
    const result = parseInlineRuleReferences(
      '[[orule: security ]] and [[orule:security]] and [[orule:frontend/react ]]'
    );

    expect(result.references).toEqual(['security', 'frontend/react']);
    expect(result.strippedText).toBe('and and');
  });

  it('detects inline rule reference presence', () => {
    expect(hasInlineRuleReference('hi [[orule:foo]]')).toBe(true);
    expect(hasInlineRuleReference('hi there')).toBe(false);
  });
});
