export interface FormattingRule {
  name: string;
  apply(lines: string[]): string[];
}
