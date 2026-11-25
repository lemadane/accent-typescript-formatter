import * as ts from 'typescript';

export interface SyntaxValidator {
  isSyntacticallyValid(
      sourceCode: string,
      languageId: string,
      originalSource?: string): boolean;
}

export class AstSyntaxValidator
  implements SyntaxValidator {
  
  public isSyntacticallyValid(
      sourceCode: string,
      languageId: string,
      originalSource?: string,
  ): boolean {
    const candidateDiagnostics = this.getDiagnostics(
        sourceCode,
        languageId);
    if (candidateDiagnostics.length === 0) {
      return originalSource === undefined || this.getDiagnostics(originalSource, languageId).length > 0
        || this.syntaxShape(sourceCode, languageId) === this.syntaxShape(originalSource, languageId);
    }
    if (originalSource !== undefined) {
      const originalDiagnostics = this.getDiagnostics(
          originalSource,
          languageId);
      return candidateDiagnostics.length <= originalDiagnostics.length;
    }
    return false;
  }

  private syntaxShape(source: string, languageId: string): string {
    const file = ts.createSourceFile('file.ts', source, ts.ScriptTarget.Latest, true, this.getScriptKind(languageId));
    const shape = (node: ts.Node): unknown => {
      const children: unknown[] = [];
      ts.forEachChild(node, child => { children.push(shape(child)); });
      // Trivia and optional punctuation do not change the AST. Literal contents do.
      return [node.kind, children.length ? children : ts.isLiteralExpression(node)
        || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)
        ? node.getText(file) : node.getText(file).replace(/\s/g, '')];
    };
    return JSON.stringify(shape(file));
  }

  private getDiagnostics(
      sourceCode: string,
      languageId: string,
  ): readonly ts.Diagnostic[] {
    const scriptKind = this.getScriptKind(languageId);
    const fileName =
        scriptKind === ts.ScriptKind.JS
            || scriptKind === ts.ScriptKind.JSX
            ? 'file.js'
            : 'file.ts';
    const sourceFile = ts.createSourceFile(
        fileName,
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        scriptKind);
    // should be no line gap
    const host: ts.CompilerHost = {
      fileExists: (f) => f === fileName,
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => '',
      getDefaultLibFileName: () => 'lib.d.ts',
      getDirectories: () => [],
      getNewLine: () => '\n',
      getSourceFile: (f) => (f === fileName
          ? sourceFile
          : undefined),
      readFile: () => undefined,
      useCaseSensitiveFileNames: () => true,
      writeFile: () => undefined,
    };
    const program = ts.createProgram(
      [fileName],
      {
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
        noLib: true,
        target: ts.ScriptTarget.ESNext,
      },
      host,
    );
    return program.getSyntacticDiagnostics(sourceFile);
  }

  private getScriptKind(languageId: string): ts.ScriptKind {
    switch (languageId) {
      case 'javascript':
        return ts.ScriptKind.JS;
      case 'javascriptreact':
        return ts.ScriptKind.JSX;
      case 'typescriptreact':
        return ts.ScriptKind.TSX;
      case 'typescript':
      default:
        return ts.ScriptKind.TS;
    }
  }
}
