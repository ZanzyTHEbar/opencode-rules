import { describe, it, expect } from 'vitest';
import {
  buildRuleCompletionSuffix,
  detectRuleCompletionRequest,
} from './text-completion.js';

describe('text-completion', () => {
  it('detects inline completion requests', () => {
    expect(detectRuleCompletionRequest('Use [[orule:sec')).toEqual({
      kind: 'inline',
      prefix: 'sec',
      suffix: ']]',
    });
  });

  it('detects command completion requests', () => {
    expect(detectRuleCompletionRequest('/orules show sec')).toEqual({
      kind: 'command',
      prefix: 'sec',
      suffix: '',
    });
  });

  it('ignores unsupported command contexts', () => {
    expect(detectRuleCompletionRequest('/orules list sec')).toBeUndefined();
    expect(detectRuleCompletionRequest('/orules active')).toBeUndefined();
  });

  it('builds only the suffix for matching completions', () => {
    expect(buildRuleCompletionSuffix('sec', 'security/review', ']]')).toBe(
      'urity/review]]'
    );
    expect(buildRuleCompletionSuffix('security', 'security')).toBeUndefined();
  });
});
