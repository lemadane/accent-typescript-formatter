import * as ts from 'typescript';

export function scriptKind(languageId: string): ts.ScriptKind {
  return languageId === 'typescriptreact' ? ts.ScriptKind.TSX
    : languageId === 'javascriptreact' ? ts.ScriptKind.JSX
    : languageId === 'javascript' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/** Opaque, collision-free placeholders keep lexical data out of layout rules. */
export function protectText(source: string, languageId: string): { text: string; ranges: readonly { start: number; end: number }[]; restore(text: string): string } {
  const file = ts.createSourceFile('file.ts', source, ts.ScriptTarget.Latest, true, scriptKind(languageId));
  const spans: { start: number; end: number; prefix: string; suffix: string }[] = [];
  const visit = (node: ts.Node): void => {
    const start = node.getStart(file);
    const raw = source.slice(start, node.end);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      spans.push({ start, end: node.end, prefix: raw[0], suffix: raw[raw.length - 1] });
    } else if (ts.isRegularExpressionLiteral(node)) {
      spans.push({ start, end: node.end, prefix: '/', suffix: '/' });
    } else if (node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail) {
      spans.push({ start, end: node.end, prefix: raw[0], suffix: node.kind === ts.SyntaxKind.TemplateTail ? '`' : '${' });
    } else if (ts.isJsxText(node)) {
      spans.push({ start: node.pos, end: node.end, prefix: '', suffix: '' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  spans.sort((a, b) => a.start - b.start);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const literalEnds = new Map(spans.map(span => [span.start, span.end]));
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const start = scanner.getTokenPos();
    const end = literalEnds.get(start);
    if (end !== undefined) { scanner.setTextPos(end); continue; }
    if (scanner.getToken() === ts.SyntaxKind.SingleLineCommentTrivia || scanner.getToken() === ts.SyntaxKind.MultiLineCommentTrivia) {
      spans.push({ start, end: scanner.getTextPos(), prefix: source.slice(start, start + 2), suffix: scanner.getToken() === ts.SyntaxKind.MultiLineCommentTrivia ? '*/' : '' });
    }
  }
  const replacements: [string, string][] = [];
  let codePoint = 0xe000;
  let text = source;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    const original = source.slice(span.start, span.end);
    let marker: string;
    do { marker = String.fromCodePoint(codePoint++); } while (source.includes(marker));
    const token = span.prefix + marker.repeat(Math.max(1, original.split(/\r?\n/)[0].length - span.prefix.length - span.suffix.length)) + span.suffix;
    replacements.push([token, original]);
    text = text.slice(0, span.start) + token + text.slice(span.end);
  }
  return { text, ranges: spans, restore: formatted => {
    for (const [token, original] of replacements) formatted = formatted.split(token).join(original);
    return formatted;
  } };
}
