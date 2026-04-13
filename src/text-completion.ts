export interface RuleCompletionRequest {
  kind: 'inline' | 'command';
  prefix: string;
  suffix: string;
}

const RULE_REFERENCE_TOKEN = /\[\[orule:([A-Za-z0-9_:./-]*)$/;
const RULE_COMMANDS = new Set(['show', 'activate', 'deactivate']);

export function detectRuleCompletionRequest(
  text: string
): RuleCompletionRequest | undefined {
  const inlineMatch = text.match(RULE_REFERENCE_TOKEN);
  if (inlineMatch) {
    return {
      kind: 'inline',
      prefix: inlineMatch[1] ?? '',
      suffix: ']]',
    };
  }

  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/orules ')) {
    return undefined;
  }

  const commandMatch = trimmed.match(/^\/orules\s+(\S+)(?:\s+(.*))?$/s);
  if (!commandMatch) {
    return undefined;
  }

  const subcommand = commandMatch[1] ?? '';
  if (!RULE_COMMANDS.has(subcommand)) {
    return undefined;
  }

  const trailingArgs = commandMatch[2] ?? '';
  const tokenMatch = trailingArgs.match(/(?:^|\s)([A-Za-z0-9_:./-]*)$/);
  const prefix = tokenMatch?.[1] ?? '';

  if (prefix.length === 0) {
    return undefined;
  }

  return {
    kind: 'command',
    prefix,
    suffix: '',
  };
}

export function buildRuleCompletionSuffix(
  prefix: string,
  match: string,
  suffix = ''
): string | undefined {
  if (!match.startsWith(prefix) || match === prefix) {
    return undefined;
  }

  return `${match.slice(prefix.length)}${suffix}`;
}
