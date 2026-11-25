import { scriptKind } from './ProtectedText';
import * as ts from 'typescript';
import { FormatterConfig } from './FormattingConfig';

/** Structural whitespace edits use parser boundaries, never commas/braces inside literals. */
export function structuralLayout(source: string, config: FormatterConfig, languageId: string): string {
  const file = ts.createSourceFile('file.tsx', source, ts.ScriptTarget.Latest, true, scriptKind(languageId));
  const edits = new Map<number, { end: number; text: string }>();
  const gap = (start: number, end: number, text: string): void => {
    if (start <= end && /^\s*$/.test(source.slice(start, end))) edits.set(start, { end, text });
  };
  const before = (pos: number, text: string): void => {
    let start = pos;
    while (start > 0 && /\s/.test(source[start - 1])) start--;
    const previousLine = source.slice(source.lastIndexOf('\n', start - 1) + 1, start);
    gap(start, pos, text === '' && previousLine.includes('//') ? '\n' : text);
  };
  const line = (pos: number): number => file.getLineAndCharacterOfPosition(pos).line;
  const containsCall = (node: ts.Node): boolean => ts.isCallExpression(node) || ts.isNewExpression(node)
    || !!ts.forEachChild(node, child => containsCall(child) || undefined);
  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
        || ts.isInterfaceDeclaration(node) || ts.isModuleBlock(node) || ts.isObjectLiteralExpression(node)) {
      const children = ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements : ts.isObjectLiteralExpression(node) ? node.properties : node.members;
      if (children.length) {
        for (const child of children) before(child.getStart(file), '\n');
        before(node.end - 1, '\n');
      }
    }
    if (ts.isDecorator(node)) {
      const next = node.parent.getChildren(file).flatMap(n => n.kind === ts.SyntaxKind.SyntaxList ? n.getChildren(file) : [n])
        .find(n => n.getStart(file) >= node.end);
      if (next) gap(node.end, next.getStart(file), '\n');
    }
    if (ts.isHeritageClause(node)) before(node.getStart(file), '\n');
    if (ts.isPropertyAccessExpression(node) && ts.isCallExpression(node.expression)) {
      const dot = node.getChildren(file).find(n => n.kind === ts.SyntaxKind.DotToken || n.kind === ts.SyntaxKind.QuestionDotToken);
      if (dot) before(dot.getStart(file), '\n');
    }
    const call = ts.isCallExpression(node) || ts.isNewExpression(node);
    const parameters = ts.isFunctionLike(node) ? node.parameters : undefined;
    const args = call ? node.arguments : parameters;
    if (args?.length) {
      const tokens = node.getChildren(file);
      const open = tokens.find(n => n.kind === ts.SyntaxKind.OpenParenToken);
      const close = tokens.find(n => n.kind === ts.SyntaxKind.CloseParenToken);
      if (open && close) {
        const signatureEnd = parameters && 'type' in node && node.type ? (node.type as ts.Node).end : close.end;
        const startLine = source.slice(source.lastIndexOf('\n', open.getStart(file) - 1) + 1, signatureEnd);
        const nested = call && args.some(containsCall);
        const wrapped = args.length > 1 || nested || startLine.length >= config.maxLineLength;
        if (wrapped) {
          gap(open.end, args[0].getStart(file), '\n');
          for (let i = 1; i < args.length; i++) before(args[i].getStart(file), '\n');
          // Preserve trailing commas, and keep closers after the final argument unless a comment intervenes.
          before(close.getStart(file), '');
        } else if (call && line(open.end) !== line(close.getStart(file))) {
          gap(open.end, args[0].getStart(file), '');
          gap(args[args.length - 1].end, close.getStart(file), '');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const [start, edit] of [...edits].sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + edit.text + source.slice(edit.end);
  }
  source = indentStructure(source, config, languageId);
  return indentStructure(layoutAssignmentCalls(source, config, languageId), config, languageId);
}

/** Measure call headers after block indentation, and only replace whitespace around =. */
function layoutAssignmentCalls(source: string, config: FormatterConfig, languageId: string): string {
  const file = ts.createSourceFile('file.tsx', source, ts.ScriptTarget.Latest, true, scriptKind(languageId));
  const edits: { start: number; end: number; text: string }[] = [];
  const columns = (text: string): number => [...text].reduce((width, ch) =>
    ch === '\t' ? width + config.tabSize - width % config.tabSize : width + 1, 0);
  const visit = (node: ts.Node): void => {
    const rhs = ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) ? node.initializer
      : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.right : undefined;
    if (rhs && (ts.isCallExpression(rhs) || ts.isNewExpression(rhs))) {
      const open = rhs.getChildren(file).find(child => child.kind === ts.SyntaxKind.OpenParenToken);
      const equals = node.getChildren(file).find(child => child.kind === ts.SyntaxKind.EqualsToken);
      if (open && equals && rhs.arguments?.length
          && file.getLineAndCharacterOfPosition(rhs.arguments[0].getStart(file)).line
            > file.getLineAndCharacterOfPosition(open.end).line) {
        let end = equals.getStart(file);
        while (end > node.getStart(file) && /\s/.test(source[end - 1])) end--;
        const prefix = source.slice(source.lastIndexOf('\n', end - 1) + 1, end);
        const call = source.slice(rhs.getStart(file), open.end);
        // Comments between the assignment and call must retain their exact position.
        if (/^\s*$/.test(source.slice(equals.end, rhs.getStart(file))) && !call.includes('\n')) {
          const wrap = columns(`${prefix} = ${call}`) > config.maxLineLength;
          edits.push({ start: end, end: rhs.getStart(file), text: wrap ? '\n= ' : ' = ' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

function indentStructure(source: string, config: FormatterConfig, languageId: string): string {
  const file = ts.createSourceFile('file.tsx', source, ts.ScriptTarget.Latest, true, scriptKind(languageId));
  const lines = source.split('\n');
  const widths = new Map<number, number>();
  const continuation = config.continuationIndent;
  const line = (pos: number): number => file.getLineAndCharacterOfPosition(pos).line;
  const mark = (pos: number, width: number): void => {
    const location = file.getLineAndCharacterOfPosition(pos);
    if (/^[ \t]*$/.test(lines[location.line].slice(0, location.character))) widths.set(location.line, width);
  };
  const visit = (node: ts.Node, width: number): void => {
    mark(node.getStart(file), width);
    for (const comment of ts.getLeadingCommentRanges(source, node.pos) ?? []) mark(comment.pos, width);
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isClassDeclaration(node)
        || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) || ts.isObjectLiteralExpression(node)
        || ts.isTypeLiteralNode(node)) {
      const children = ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements
        : ts.isObjectLiteralExpression(node) ? node.properties : node.members;
      for (const child of node.getChildren(file)) {
        if (child.kind !== ts.SyntaxKind.SyntaxList) visit(child, width);
        else for (const item of child.getChildren(file)) {
          if (!(children as readonly ts.Node[]).includes(item)) visit(item, width + (ts.isHeritageClause(item) ? continuation : 0));
        }
      }
      for (const child of children) visit(child, width + config.tabSize);
      mark(node.end - 1, width);
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      visit(node.expression, width);
      const chained = ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression);
      const callWidth = width + (chained ? continuation : 0);
      for (const arg of node.arguments ?? []) {
        visit(arg, callWidth + (line(arg.getStart(file)) > line(node.expression.end) ? continuation : 0));
      }
      for (const type of node.typeArguments ?? []) visit(type, width);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression, width);
      for (const child of node.getChildren(file).slice(1)) visit(child, width + (ts.isCallExpression(node.expression) ? continuation : 0));
      return;
    }
    if (ts.isFunctionLike(node)) {
      for (const child of node.getChildren(file)) {
        if (child.kind === ts.SyntaxKind.SyntaxList) {
          for (const item of child.getChildren(file)) visit(item, node.parameters.includes(item as ts.ParameterDeclaration) ? width + continuation : width);
        } else visit(child, width);
      }
      return;
    }
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      const equals = node.getChildren(file).find(child => child.kind === ts.SyntaxKind.EqualsToken);
      if (equals) mark(equals.getStart(file), width + continuation);
    }
    ts.forEachChild(node, child => {
      let next = width;
      if (ts.isHeritageClause(child)) next += continuation;
      if (ts.isParenthesizedExpression(node) && line(child.getStart(file)) > line(node.getStart(file))) next += continuation;
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && child === node.initializer
          && line(child.getStart(file)) > line(node.getStart(file))) next += continuation;
      if (ts.isConditionalExpression(node) && child !== node.condition) next += continuation;
      if (ts.isBinaryExpression(node) && child !== node.left && line(child.getStart(file)) > line(node.left.end)) next += continuation;
      visit(child, next);
    });
  };
  const firstLine = lines.find(text => text.trim()) ?? '';
  const prefix = firstLine.match(/^[ \t]*/)?.[0] ?? '';
  const baseWidth = [...prefix].reduce((width, ch) => ch === '\t' ? width + config.tabSize - width % config.tabSize : width + 1, 0);
  visit(file, baseWidth);
  for (const [index, width] of widths) {
    const indent = config.insertSpaces ? ' '.repeat(width)
      : '\t'.repeat(Math.floor(width / config.tabSize)) + ' '.repeat(width % config.tabSize);
    lines[index] = indent + lines[index].trimStart();
  }
  return lines.join('\n');
}
