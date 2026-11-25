import * as ts from 'typescript';

export interface AstFormattingEngine {
    formatWithAst(
      sourceCode: string,
      languageId: string): string;
}


export class TypeScriptAstFormattingEngine
  implements AstFormattingEngine {
    public formatWithAst(
      sourceCode: string,
      languageId: string,): string {
        const scriptKind = this.getScriptKind(languageId);
        if (scriptKind === ts.ScriptKind.Unknown) {
            return sourceCode;
        }
        try {
            const fileName = scriptKind === ts.ScriptKind.TSX
              ? 'file.tsx'
              : 'file.ts';
            const sourceFile = ts.createSourceFile(
              fileName,
              sourceCode,
              ts.ScriptTarget.Latest,
              true,
              scriptKind);
            if (!sourceCode.includes('\n')
              && !sourceCode.includes('\r')) {
                const indentation = sourceCode.match(/^[ \t]*/)?.[0] ?? '';
                const printed = ts.createPrinter(
                  {
                      newLine: ts.NewLineKind.LineFeed
                  })
                  .printFile(sourceFile);
                return printed.split('\n').map(line => line ? indentation + line : line).join('\n');
            }
            const host: ts.LanguageServiceHost = {
                getCompilationSettings: () => ({
                    allowJs: true,
                    jsx: ts.JsxEmit.Preserve
                }),
                getScriptFileNames: () => [fileName],
                getScriptVersion: () => '0',
                getScriptSnapshot: name => name === fileName
                  ? ts.ScriptSnapshot.fromString(
                    sourceCode)
                  : undefined,
                getScriptKind: () => scriptKind,
                getCurrentDirectory: () => '',
                getDefaultLibFileName: () => 'lib.d.ts',
                fileExists: name => name === fileName,
                readFile: name => name === fileName
                  ? sourceCode
                  : undefined,
            };
            const service = ts.createLanguageService(host);
            try {
                const edits = service.getFormattingEditsForDocument(
                  fileName,
                  {
                      indentSize: 4,
                      tabSize: 4,
                      convertTabsToSpaces: true,
                      newLineCharacter: '\n',
                      insertSpaceAfterCommaDelimiter: true,
                      insertSpaceBeforeAndAfterBinaryOperators: true,
                      insertSpaceAfterKeywordsInControlFlowStatements: true,
                      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
                      insertSpaceAfterSemicolonInForStatements: true,
                  });
                for (const edit of edits.sort(
                  (
                    a,
                    b) => b.span.start - a.span.start)) {
                    // Structural layout owns indentation; this pass only normalizes inline spacing.
                    const old = sourceCode.slice(
                      edit.span.start,
                      edit.span.start + edit.span.length);
                    const linePrefix = sourceCode.slice(
                      sourceCode.lastIndexOf(
                        '\n',
                        edit.span.start - 1) + 1,
                      edit.span.start);
                    if (old.includes('\n')
                      || edit.newText.includes('\n')
                      || !linePrefix.trim()) continue;
                    sourceCode = sourceCode.slice(
                      0,
                      edit.span.start) + edit.newText + sourceCode.slice(
                      edit.span.start + edit.span.length);
                }
                return sourceCode;
            } finally {
                service.dispose();
            }
        } catch {
            return sourceCode;
        }
    }
    private getScriptKind(languageId: string): ts.ScriptKind {
        switch (languageId) {
        case 'typescript':
        return ts.ScriptKind.TS;
        case 'javascript':
        return ts.ScriptKind.JS;
        case 'javascriptreact':
        return ts.ScriptKind.JSX;
        case 'typescriptreact':
        return ts.ScriptKind.TSX;
        default:
        return ts.ScriptKind.Unknown;
    }
    }
}
