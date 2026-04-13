const INLINE_RULE_REFERENCE_PATTERN = /\[\[orule:([^\]\n]+?)\]\]/g;

export interface InlineRuleReferenceResult {
  references: string[];
  strippedText: string;
}

export function parseInlineRuleReferences(
  text: string
): InlineRuleReferenceResult {
  const references: string[] = [];

  const strippedText = text
    .replace(INLINE_RULE_REFERENCE_PATTERN, (_match, reference: string) => {
      const trimmed = reference.trim();
      if (trimmed.length > 0) {
        references.push(trimmed);
      }
      return ' ';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    references: Array.from(new Set(references)),
    strippedText,
  };
}

export function hasInlineRuleReference(text: string): boolean {
  return /\[\[orule:([^\]\n]+?)\]\]/.test(text);
}
