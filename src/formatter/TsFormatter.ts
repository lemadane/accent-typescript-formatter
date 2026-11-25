import { protectText } from './ProtectedText';
import { AstSyntaxValidator, SyntaxValidator } from './AstSyntaxValidator';
import { AstFormattingEngine, TypeScriptAstFormattingEngine } from './AstFormattingEngine';
import { FormatterConfig } from './FormattingConfig';
import { TsRulesEngine } from './TsRulesEngine';

export interface FormattingRulesApplier {
  applyRules(sourceCode: string, languageId?: string): string;
}

export class TsFormatter {
  private static readonly MAX_STABILIZATION_ATTEMPTS = 6;

  private readonly rulesEngine: FormattingRulesApplier;
  private readonly astFormatter: AstFormattingEngine;

  constructor(
    private readonly config: FormatterConfig,
    private readonly syntaxValidator: SyntaxValidator =
        new AstSyntaxValidator(),
    rulesEngine?: FormattingRulesApplier,
    astFormatter: AstFormattingEngine = new TypeScriptAstFormattingEngine(),
  ) {
    this.rulesEngine = rulesEngine ?? new TsRulesEngine(config);
    this.astFormatter = astFormatter;
  }

    public async formatDocument(
      sourceCode: string,
      languageId: string
  ): Promise<string> {
        if (!this.config.enabled) return sourceCode;
        return this.applyRulesSafely(
        sourceCode,
        languageId
    );
  }

  public async formatRange(
    sourceCode: string,
    startOffset: number,
    endOffset: number,
    languageId: string,
  ): Promise<string> {
    if (!this.config.enabled) return sourceCode;
    const start = Math.max(0, Math.min(startOffset, sourceCode.length));
    const end = Math.max(start, Math.min(endOffset, sourceCode.length));
    const { ranges } = protectText(sourceCode, languageId);
    if (ranges.some(range => (range.start < start && start < range.end)
        || (range.start < end && end < range.end))) return sourceCode;
    const selected = sourceCode.slice(start, end);
    let formatted = await this.applyRulesSafely(selected, languageId);
    if (!/[\r\n]$/.test(selected)) formatted = formatted.replace(/[\r\n]+$/, '');
    const candidate = sourceCode.slice(0, start) + formatted + sourceCode.slice(end);
    // A valid standalone fragment can become invalid in its enclosing expression.
    return this.isSafeFormattedCandidate(candidate, sourceCode, languageId)
      ? candidate : sourceCode;
  }

    private async applyRulesSafely(
      sourceCode: string,
      languageId: string
  ): Promise<string> {
        const candidate = this.tryCreateStableCandidate(sourceCode, languageId);
    if (candidate === null) {
      return sourceCode;
    }
    if (this.isSafeFormattedCandidate(candidate, sourceCode, languageId)) {
      return candidate;
    }

    return sourceCode;
  }

  private tryCreateStableCandidate(
      sourceCode: string,
      languageId: string): string | null {
        let candidate = this.applyFormattingPipeline(
        sourceCode,
        languageId
    );

    for (let i = 0; i < TsFormatter.MAX_STABILIZATION_ATTEMPTS; i++) {
            const next = this.applyFormattingPipeline(
          candidate,
          languageId
      );
      if (next === candidate) {
        return candidate;
      }
      candidate = next;
    }

    return null;
  }

  private applyFormattingPipeline(
      sourceCode: string,
      languageId: string): string {
    const protectedText = protectText(sourceCode, languageId);
    const astNormalized = this.astFormatter.formatWithAst(
        protectedText.text,
        languageId
    );
    const result = this.rulesEngine.applyRules(astNormalized, languageId);
    const eol = sourceCode.includes('\r\n') ? '\r\n' : '\n';
    return protectedText.restore(result.replace(/\r?\n/g, eol));
  }

  private isSafeFormattedCandidate(
      candidate: string,
      originalSource: string,
      languageId: string): boolean {
    if (candidate === originalSource) {
      return true;
    }

    return this.syntaxValidator.isSyntacticallyValid(
      candidate,
      languageId,
      originalSource,
    );
  }
}
