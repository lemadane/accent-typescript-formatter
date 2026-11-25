import * as ts from 'typescript';
import { FormatterConfig } from './FormattingConfig';
import { scriptKind } from './ProtectedText';
import { structuralLayout } from './StructuralLayout';
import { FormattingRule } from './FormattingRule';

export class TsRulesEngine {
    private languageId = 'typescript';
    private readonly rules: FormattingRule[];
    constructor(
      private readonly config: FormatterConfig,
      rules?: FormattingRule[],) {
        this.rules = rules
          ?? this.createDefaultRules();
    }
    public applyRules(
      sourceCode: string,
      languageId = 'typescript'): string {
        this.languageId = languageId;
        return this.applyFormattingRules(sourceCode);
    }
    private applyFormattingRules(sourceCode: string): string {
        let lines = sourceCode.split(/\r?\n/);
        const normalizedLines = this.ruleBlockStatementIndent(lines);
        if (this.hasNoAdditionalSyntaxErrors(
          normalizedLines,
          lines)) {
            lines = normalizedLines;
        }
        for (const rule of this.rules) {
            const candidate = rule.apply(lines);
            if (this.hasNoAdditionalSyntaxErrors(
              candidate,
              lines)) {
                lines = candidate;
            }
        }
        return structuralLayout(
          lines.join('\n'),
          this.config,
          this.languageId);
    }
    private hasNoAdditionalSyntaxErrors(
      candidateLines: string[],
      originalLines: string[]): boolean {
        const getSyntaxErrorCount = (sourceCode: string): number => {
            const fileName = 'file.tsx';
            const sourceFile = ts.createSourceFile(
              fileName,
              sourceCode,
              ts.ScriptTarget.Latest,
              true,
              scriptKind(this.languageId),);
            const host: ts.CompilerHost = {
                fileExists: (file) => file === fileName,
                getCanonicalFileName: (file) => file,
                getCurrentDirectory: () => '',
                getDefaultLibFileName: () => 'lib.d.ts',
                getDirectories: () => [],
                getNewLine: () => '\n',
                getSourceFile: (file) => (file === fileName
                  ? sourceFile
                  : undefined),
                readFile: () => undefined,
                useCaseSensitiveFileNames: () => true,
                writeFile: () => undefined,
            };
            const program = ts.createProgram(
              [fileName],
              {
                  noLib: true,
                  target: ts.ScriptTarget.ESNext
              },
              host,);
            return program.getSyntacticDiagnostics(sourceFile)
              .length;
        };
        return (
          getSyntaxErrorCount(
            candidateLines.join('\n')) <=
            getSyntaxErrorCount(
              originalLines.join('\n'))
    );
    }
    private createDefaultRules(): FormattingRule[] {
        return [
        {
            name: 'maxLineLengthWrapping',
            apply: (lines) => this.ruleMaxLineLengthWrapping(
              lines)
        },
        {
            name: 'ifLogicalConditionWrapping',
            apply: (lines) => this.ruleIfLogicalConditionWrapping(
              lines)
        },
        {
            name: 'noBlankLinesInFunctions',
            apply: (lines) => this.ruleNoBlankLinesInFunctions(
              lines)
        },
    ];
    }
    private ruleBlockStatementIndent(lines: string[]): string[] {
        const sourceCode = lines.join('\n');
        const sourceFile = ts.createSourceFile(
          'file.tsx',
          sourceCode,
          ts.ScriptTarget.Latest,
          true,
          scriptKind(this.languageId),);
        const output = [...lines];
        const visit = (node: ts.Node): void => {
            if (ts.isStatement(node)
              && ts.isBlock(node.parent)) {
                const lineIndex =
                  sourceFile.getLineAndCharacterOfPosition(
                    node
                    .getStart(sourceFile))
                    .line;
                const blockLineIndex =
                  sourceFile.getLineAndCharacterOfPosition(
                    node.parent
                    .getStart(sourceFile))
                    .line;
                const currentIndent =
                  output[lineIndex].match(/^\s*/)?.[0]
                    ?? '';
                const blockIndent =
                  lines[blockLineIndex].match(/^\s*/)?.[0]
                    ?? '';
                const expectedIndent =
                  `${blockIndent}${this.indentUnit()}`;
                if (currentIndent.length > expectedIndent.length) {
                    output[lineIndex] =
                      `${expectedIndent}${output[lineIndex].trimStart()}`;
                }
            }
            ts.forEachChild(
              node,
              visit);
        };
        visit(sourceFile);
        return output;
    }
    private ruleMaxLineLengthWrapping(lines: string[]): string[] {
        let output = lines;
        output = this.ruleNullishCoalescingWrapping(output);
        output = this.ruleTernaryWrapping(output);
        output = this.ruleAssignmentWrapping(output);
        return output;
    }
    private ruleNullishCoalescingWrapping(lines: string[]): string[] {
        const output: string[] = [];
        for (const line of lines) {
            if (!line.includes('??')) {
                output.push(line);
                continue;
            }
            const assignmentIndex =
              this.findTopLevelAssignmentIndex(line);
            const expression = assignmentIndex >= 0
              ? line.slice(assignmentIndex + 1)
                .trim()
              : line.trim();
            let { parts, operators } = this.splitTopLevelLogicalAndOr(
              expression,
              0);
            let operands = parts.map(
              (part) => part
              .trim())
              .filter(Boolean);
            if (operands.length < 2) {
                const nested =
                  this.splitNullishAtMatchingDepth(expression);
                parts = nested.parts;
                operators = nested.operators;
                operands = parts.map(
                  (part) => part
                  .trim())
                  .filter(Boolean);
            }
            if (operands.length < 2
              || operators.some((operator) => operator !== '??')) {
                output.push(line);
                continue;
            }
            const indent = line.match(/^\s*/)?.[0]
              ?? '';
            const continuationIndent =
              `${indent}${this.continuationUnit()}`;
            const firstLine = assignmentIndex >= 0
              ? `${line.slice(
                0,
                assignmentIndex + 1)
                .trimEnd()} ${operands[0]}`
              : `${indent}${operands[0]}`;
            output.push(firstLine);
            for (let i = 1; i < operands.length; i++) {
                const suffix = i === operands.length - 1
                  ? ''
                  : '';
                output.push(
                  `${continuationIndent}?? ${operands[i]}${suffix}`);
            }
        }
        return output;
    }
    private splitNullishAtMatchingDepth(
      expression: string,): { parts: string[]; operators: string[] } {
        const positions: number[] = [];
        let quote = '';
        for (let i = 0; i < expression.length - 1; i++) {
            const ch = expression[i];
            if (quote) {
                if (ch === quote
                  && expression[i - 1] !== '\\') {
                    quote = '';
                }
                continue;
            }
            if (ch === "'"
              || ch === '"'
              || ch === '`') {
                quote = ch;
                continue;
            }
            if (ch === '('
              || ch === ')') {
                continue;
            }
            if (ch === '?'
              && expression[i + 1] === '?') {
                positions.push(i);
                i++;
            }
        }
        if (positions.length === 0) {
            return {
                parts: [expression],
                operators: []
            };
        }
        const parts: string[] = [];
        const operators: string[] = [];
        let start = 0;
        for (const position of positions) {
            parts.push(
              expression.slice(
                start,
                position));
            operators.push('??');
            start = position + 2;
        }
        parts.push(
          expression.slice(start));
        return {
            parts,
            operators
        };
    }
    private shouldSkipLineTransforms(line: string): boolean {
        const trimmed = line.trimStart();
        return (
          trimmed.startsWith('//') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith("'") ||
            trimmed.startsWith('"') ||
            trimmed.startsWith('`')
    );
    }
    private ruleIfLogicalConditionWrapping(lines: string[]): string[] {
        const output: string[] = [];
        const skipIndexes = new Set<number>();
        for (let index = 0; index < lines.length; index++) {
            if (skipIndexes.has(index)) {
                continue;
            }
            const line = lines[index];
            if (this.shouldSkipLineTransforms(line)) {
                output.push(line);
                continue;
            }
            const trimmed = line.trim();
            const isIfLike =
              /^if\s*\(/.test(trimmed) || /^}\s*else\s+if\s*\(/
              .test(trimmed);
            if (isIfLike
              && trimmed.endsWith('(')
              && !trimmed.includes(')')) {
                let firstConditionIndex = -1;
                for (let i = index + 1; i < lines.length; i++) {
                    const innerTrimmed = lines[i].trim();
                    if (!innerTrimmed) {
                        continue;
                    }
                    if (innerTrimmed.startsWith(')')) {
                        break;
                    }
                    firstConditionIndex = i;
                    break;
                }
                if (firstConditionIndex !== -1) {
                    const firstCondition =
                      lines[firstConditionIndex].trim();
                    const hasLogicalOperator =
                      firstCondition.includes('&&') || firstCondition
                      .includes('||');
                    const indent = line.match(/^\s*/)?.[0]
                      ?? '';
                    if (firstCondition.includes('||')
                      && firstCondition.endsWith('&&')) {
                        const { parts, operators }
                          = this.splitTopLevelLogicalAndOr(
                            firstCondition,
                            1);
                        const normalizedParts = parts.map(
                          (part) => part
                          .trim())
                          .filter(Boolean);
                        if (normalizedParts.length >= 2
                          && operators[0] === '||') {
                            output.push(
                              `${indent}${trimmed}${normalizedParts[0]}`);
                            output.push(
                              `${indent}${this.continuationUnit()}|| ${normalizedParts[1]}`,);
                            const secondConditionIndex =
                              firstConditionIndex + 1 < lines.length
                                ? firstConditionIndex + 1
                                : -1;
                            if (secondConditionIndex !== -1) {
                                const secondCondition =
                                  lines[secondConditionIndex].trim();
                                if (secondCondition &&
                                  !secondCondition.startsWith('&&') &&
                                  !secondCondition.startsWith('||') &&
                                  !secondCondition.startsWith(')')
                ) {
                                    output.push(
                                      `${indent}${this.continuationUnit()}&& ${secondCondition}`,);
                                    skipIndexes.add(secondConditionIndex);
                                }
                            }
                            skipIndexes.add(firstConditionIndex);
                            continue;
                        }
                    }
                    if (hasLogicalOperator) {
                        const { parts, operators }
                          = this.splitTopLevelLogicalAndOr(
                            firstCondition,
                            1);
                        const normalizedParts = parts.map(
                          (part) => part
                          .trim())
                          .filter(Boolean);
                        if (normalizedParts.length >= 2) {
                            const mergedHead =
                              `${indent}${trimmed}${normalizedParts[0]}`;
                            if (mergedHead.length <=
                              this.config.maxLineLength) {
                                output.push(mergedHead);
                                for (let i =
                                  1; i < normalizedParts.length; i++) {
                                    const operator = operators[i - 1]
                                      ?? '&&';
                                    output.push(
                                      `${indent}${this.continuationUnit()}${operator} ${
                                      normalizedParts[i]
                                      }`,);
                                }
                                skipIndexes.add(firstConditionIndex);
                                continue;
                            }
                        }
                        const merged =
                          `${indent}${trimmed}${firstCondition}`;
                        if (merged.length <=
                          this.config.maxLineLength) {
                            output.push(merged);
                            skipIndexes.add(firstConditionIndex);
                            continue;
                        }
                    }
                }
            }
            if (!isIfLike
              || (!line.includes('||')
                && !line.includes('&&'))) {
                output.push(line);
                continue;
            }
            const openIdx = line.indexOf('(');
            const closeIdx = this.findMatchingParenIndex(
              line,
              openIdx);
            if (openIdx < 0
              || closeIdx <= openIdx) {
                output.push(line);
                continue;
            }
            const condition = line.slice(
              openIdx + 1,
              closeIdx);
            const { parts, operators }
              = this.splitTopLevelLogicalAndOr(
                condition,
                1);
            const normalizedParts = parts.map(
              (part) => part
              .trim())
              .filter(Boolean);
            const normalizedOps = operators.slice(
              0,
              Math
              .max(
                0,
                normalizedParts.length - 1));
            if (normalizedParts.length < 2) {
                output.push(line);
                continue;
            }
            const indent = line.match(/^\s*/)?.[0]
              ?? '';
            const head = line.slice(
              0,
              openIdx + 1)
              .trim();
            const tail = line.slice(closeIdx);
            output.push(`${indent}${head}${normalizedParts[0]}`);
            for (let i = 1; i < normalizedParts.length; i++) {
                const suffix = i === normalizedParts.length - 1
                  ? tail
                  : '';
                const operator = normalizedOps[i - 1]
                  ?? '||';
                output.push(
                  `${indent}${this.continuationUnit()}${operator} ${
                  normalizedParts[i]
                  }${suffix}`,);
            }
        }
        return output;
    }

    // Rule: ternary statements are split into aligned condition and branch lines.
    private ruleTernaryWrapping(lines: string[]): string[] {
        const output: string[] = [];
        const sourceFile = ts.createSourceFile(
          'file.tsx',
          lines.join('\n'),
          ts.ScriptTarget.Latest,
          true,
          scriptKind(this.languageId),);
        const ternariesByLine =
          new Map<number, ts.ConditionalExpression[]>();
        const collectTernaries = (node: ts.Node): void => {
            if (ts.isConditionalExpression(node)) {
                const expressionStart
                  = sourceFile.getLineAndCharacterOfPosition(
                    node
                    .getStart(sourceFile));
                const expressionEnd
                  = sourceFile.getLineAndCharacterOfPosition(
                    node
                    .getEnd());
                const conditionStart
                  = sourceFile.getLineAndCharacterOfPosition(
                    node.condition
                    .getStart(sourceFile));
                if (expressionStart.line === expressionEnd.line &&
                  expressionStart.line === conditionStart.line
        ) {
                    const ternaries =
                      ternariesByLine.get(expressionStart.line)
                        ?? [];
                    ternaries.push(node);
                    ternariesByLine.set(
                      expressionStart.line,
                      ternaries);
                }
            }
            ts.forEachChild(
              node,
              collectTernaries);
        };
        collectTernaries(sourceFile);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trimStart();
            if (trimmed.startsWith(':')) {
                let matchedQuestionBranch = false;
                for (let previousIndex =
                  i - 1; previousIndex >= 0; previousIndex--) {
                    const previous = lines[previousIndex];
                    const previousTrimmed = previous.trimStart();
                    if (previousTrimmed.startsWith('? ')) {
                        const questionIndent =
                          previous.match(/^\s*/)?.[0]
                            ?? '';
                        output.push(`${questionIndent}${trimmed}`);
                        matchedQuestionBranch = true;
                        break;
                    }
                    if (previousTrimmed.startsWith(': ')
                      || previousTrimmed === '}') {
                        break;
                    }
                }
                if (matchedQuestionBranch) {
                    continue;
                }
            }
            if (!trimmed.startsWith('?') &&
              !trimmed.startsWith(':') &&
              i + 2 < lines.length &&
              lines[i + 1].trim()
                .startsWith('?') &&
              lines[i + 2].trim()
                .startsWith(':')
      ) {
                const { parts, operators }
                  = this.splitTopLevelLogicalAndOr(
                    trimmed,
                    0);
                const logicalParts = parts.map(
                  (part) => part
                  .trim())
                  .filter(Boolean);
                if (logicalParts.length > 1) {
                    const indent = line.match(/^\s*/)?.[0]
                      ?? '';
                    const continuationIndent =
                      `${indent}${this.continuationUnit()}`;
                    output.push(`${indent}${logicalParts[0]}`);
                    for (let partIndex =
                      1; partIndex < logicalParts.length; partIndex++) {
                        const operator = operators[partIndex - 1]
                          ?? '&&';
                        output.push(
                          `${continuationIndent}${operator} ${logicalParts[partIndex]}`);
                    }
                    output.push(
                      `${continuationIndent}${lines[i + 1].trim()}`);
                    output.push(
                      `${continuationIndent}${lines[i + 2].trim()}`);
                    i += 2;
                    continue;
                }
            }
            if (trimmed.startsWith('? ')
              && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                const nextTrimmed = nextLine.trim();
                if (nextTrimmed.startsWith(':')) {
                    const conditionLine = output[output.length - 1]
                      ?? '';
                    const conditionIndent =
                      conditionLine.match(/^\s*/)?.[0]
                        ?? '';
                    const previousTrimmed = conditionLine.trimStart();
                    const branchIndent =
                      previousTrimmed.startsWith('||') || previousTrimmed
                      .startsWith('&&')
                        ? conditionIndent
                        : `${conditionIndent}${this.continuationUnit()}`;
                    output.push(`${branchIndent}${trimmed}`);
                    output.push(`${branchIndent}${nextTrimmed}`);
                    i++;
                    continue;
                }
            }
            if (trimmed.startsWith('//') ||
              trimmed.startsWith('*') ||
              trimmed.startsWith('/*') ||
              !line.includes('?') ||
              !line.includes(':')
      ) {
                output.push(line);
                continue;
            }
            const split = this.findTernarySplitIndexes(line);
            if (!split) {
                const nestedTernary = ternariesByLine.get(i)?.[0];
                if (nestedTernary) {
                    const lineStart
                      = sourceFile.getPositionOfLineAndCharacter(
                        i,
                        0);
                    const conditionStart =
                      nestedTernary.condition.getStart(
                        sourceFile) - lineStart;
                    const conditionEnd =
                      nestedTernary.condition.end - lineStart;
                    const trueStart = nestedTernary.whenTrue.getStart(
                      sourceFile) - lineStart;
                    const trueEnd =
                      nestedTernary.whenTrue.end - lineStart;
                    const falseStart =
                      nestedTernary.whenFalse.getStart(
                        sourceFile) - lineStart;
                    const falseEnd =
                      nestedTernary.whenFalse.end - lineStart;
                    const indent = line.match(/^\s*/)?.[0]
                      ?? '';
                    const branchIndent =
                      `${indent}${this.continuationUnit()}`;
                    const prefix = line.slice(
                      0,
                      conditionStart);
                    const condition = line.slice(
                      conditionStart,
                      conditionEnd)
                      .trimEnd();
                    const whenTrue = line.slice(
                      trueStart,
                      trueEnd)
                      .trim();
                    const whenFalse = line.slice(
                      falseStart,
                      falseEnd)
                      .trim();
                    const suffix = line.slice(falseEnd);
                    if (condition
                      && whenTrue
                      && whenFalse) {
                        output.push(`${prefix}${condition}`);
                        output.push(`${branchIndent}? ${whenTrue}`);
                        output.push(
                          `${branchIndent}: ${whenFalse}${suffix}`);
                        continue;
                    }
                }
                output.push(line);
                continue;
            }
            const { q, c } = split;
            if (q < 0
              || c < 0
              || q > c) {
                output.push(line);
                continue;
            }
            const indent = line.match(/^\s*/)?.[0]
              ?? '';
            const left = line.slice(
              0,
              q)
              .trimEnd();
            const whenTrue = line.slice(
              q + 1,
              c)
              .trim();
            const whenFalse = line.slice(c + 1)
              .trim();
            if (!left
              || !whenTrue
              || !whenFalse) {
                output.push(line);
                continue;
            }
            const assignmentIndex =
              this.findTopLevelAssignmentIndex(left);
            const conditionExpression = assignmentIndex >= 0
              ? left.slice(assignmentIndex + 1)
                .trimStart()
              : left;
            const { parts, operators }
              = this.splitTopLevelLogicalAndOr(
                conditionExpression,
                0);
            const logicalParts = parts.map(
              (part) => part
              .trim())
              .filter(Boolean);
            const branchIndent =
              `${indent}${this.continuationUnit()}`;
            if (logicalParts.length > 1) {
                if (assignmentIndex >= 0) {
                    const beforeAssignment = left.slice(
                      0,
                      assignmentIndex + 1)
                      .trimEnd();
                    const firstConditionIndent =
                      `${indent}${this.continuationUnit()}`;
                    const continuationIndent =
                      `${firstConditionIndent}${this.continuationUnit()}`;
                    output.push(beforeAssignment);
                    output.push(
                      `${firstConditionIndent}${logicalParts[0]}`);
                    for (let i = 1; i < logicalParts.length; i++) {
                        const operator = operators[i - 1]
                          ?? '&&';
                        output.push(
                          `${continuationIndent}${operator} ${logicalParts[i]}`);
                    }
                    output.push(
                      `${continuationIndent}? ${whenTrue}`);
                    output.push(
                      `${continuationIndent}: ${whenFalse}`);
                    continue;
                }
                output.push(`${indent}${logicalParts[0]}`);
                for (let i = 1; i < logicalParts.length; i++) {
                    const operator = operators[i - 1]
                      ?? '&&';
                    output.push(
                      `${branchIndent}${operator} ${logicalParts[i]}`);
                }
                output.push(`${branchIndent}? ${whenTrue}`);
                output.push(`${branchIndent}: ${whenFalse}`);
                continue;
            }
            output.push(left);
            output.push(`${branchIndent}? ${whenTrue}`);
            output.push(`${branchIndent}: ${whenFalse}`);
        }
        return this.ruleRemainingTernaryWrapping(output);
    }
    private ruleRemainingTernaryWrapping(lines: string[]): string[] {
        const source = lines.join('\n');
        const sourceFile = ts.createSourceFile(
          'file.tsx',
          source,
          ts.ScriptTarget.Latest,
          true,
          scriptKind(this.languageId));
        const edits: { start: number; end: number; text: string }[] =
          [];
        const visit = (node: ts.Node): void => {
            if (ts.isConditionalExpression(node)) {
                const conditionLine =
                  sourceFile.getLineAndCharacterOfPosition(
                    node.condition
                    .getStart(sourceFile))
                    .line;
                const indent = lines[conditionLine].match(/^\s*/)?.[0]
                  ?? '';
                const branchIndent =
                  `${indent}${this.continuationUnit()}`;
                for (const [preceding, token] of [
                [node.condition, node.questionToken],
                [node.whenTrue, node.colonToken],
        ] as const) {
                    const start = token.getStart(sourceFile);
                    const precedingEnd = preceding.getEnd();
                    const tokenLine =
                      sourceFile.getLineAndCharacterOfPosition(
                        start)
                        .line;
                    const precedingLine =
                      sourceFile.getLineAndCharacterOfPosition(
                        precedingEnd)
                        .line;
                    const between = source.slice(
                      precedingEnd,
                      start);
                    if (precedingLine === tokenLine
                      && /^[ \t]*$/.test(between)) {
                        edits.push(
                          {
                              start: precedingEnd,
                              end: start,
                              text: `\n${branchIndent}`
                          });
                    } else if (ts.isConditionalExpression(
                      node.parent)
                      && tokenLine > precedingLine
                      && lines[tokenLine].trimStart()
                        .startsWith(
                          token.getText(
                            sourceFile))) {
                        // A nested branch may already be on its own line but still carry its parent's indentation.
                        const lineStart
                          = sourceFile.getPositionOfLineAndCharacter(
                            tokenLine,
                            0);
                        if (source.slice(
                          lineStart,
                          start)
                          .trim() === ''
                          && start - lineStart !== branchIndent.length) {
                            edits.push(
                              {
                                  start: lineStart,
                                  end: start,
                                  text: branchIndent
                              });
                        }
                    }
                }
            }
            ts.forEachChild(
              node,
              visit);
        };
        visit(sourceFile);
        edits.sort((
          a,
          b) => b.start - a.start);
        let formatted = source;
        for (const edit of edits) {
            formatted = `${formatted.slice(
              0,
              edit.start)}${edit.text}${formatted
            .slice(edit.end)}`;
        }
        return formatted.split('\n');
    }
    private findTopLevelAssignmentIndex(text: string): number {
        let paren = 0;
        let bracket = 0;
        let brace = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const prev = i > 0
              ? text[i - 1]
              : '';
            const next = i + 1 < text.length
              ? text[i + 1]
              : '';
            if (!inDouble
              && !inTemplate
              && ch === "'"
              && !this.isEscaped(
                text,
                i)) {
                inSingle = !inSingle;
                continue;
            }
            if (!inSingle
              && !inTemplate
              && ch === '"'
              && !this.isEscaped(
                text,
                i)) {
                inDouble = !inDouble;
                continue;
            }
            if (!inSingle
              && !inDouble
              && ch === '`'
              && !this.isEscaped(
                text,
                i)) {
                inTemplate = !inTemplate;
                continue;
            }
            if (inSingle
              || inDouble
              || inTemplate) {
                continue;
            }
            if (ch === '(') {
                paren++;
                continue;
            }
            if (ch === ')') {
                paren = Math.max(
                  0,
                  paren - 1);
                continue;
            }
            if (ch === '[') {
                bracket++;
                continue;
            }
            if (ch === ']') {
                bracket = Math.max(
                  0,
                  bracket - 1);
                continue;
            }
            if (ch === '{') {
                brace++;
                continue;
            }
            if (ch === '}') {
                brace = Math.max(
                  0,
                  brace - 1);
                continue;
            }
            if (paren === 0
              && bracket === 0
              && brace === 0
              && ch === '='
              && prev !== '>'
              && prev !== '<'
              && prev !== '!'
              && next !== '=') {
                return i;
            }
        }
        return -1;
    }
    private findTernarySplitIndexes(
      line: string): { q: number; c: number } | null {
        let paren = 0;
        let bracket = 0;
        let brace = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let qIndex = -1;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const prev = i > 0
              ? line[i - 1]
              : '';
            const next = i + 1 < line.length
              ? line[i + 1]
              : '';
            if (!inDouble
              && !inTemplate
              && ch === "'"
              && !this.isEscaped(
                line,
                i)) {
                inSingle = !inSingle;
                continue;
            }
            if (!inSingle
              && !inTemplate
              && ch === '"'
              && !this.isEscaped(
                line,
                i)) {
                inDouble = !inDouble;
                continue;
            }
            if (!inSingle
              && !inDouble
              && ch === '`'
              && !this.isEscaped(
                line,
                i)) {
                inTemplate = !inTemplate;
                continue;
            }
            if (inSingle
              || inDouble
              || inTemplate) {
                continue;
            }
            if (ch === '(') {
                paren++;
                continue;
            }
            if (ch === ')') {
                paren = Math.max(
                  0,
                  paren - 1);
                continue;
            }
            if (ch === '[') {
                bracket++;
                continue;
            }
            if (ch === ']') {
                bracket = Math.max(
                  0,
                  bracket - 1);
                continue;
            }
            if (ch === '{') {
                brace++;
                continue;
            }
            if (ch === '}') {
                brace = Math.max(
                  0,
                  brace - 1);
                continue;
            }
            if (paren === 0
              && bracket === 0
              && brace === 0) {
                if (qIndex === -1 &&
                  ch === '?' &&
                  next !== '?' &&
                  next !== '.' &&
                  prev !== '?'
        ) {
                    qIndex = i;
                    continue;
                }
                if (qIndex !== -1
                  && ch === ':') {
                    return {
                        q: qIndex,
                        c: i
                    };
                }
            }
        }
        return null;
    }
    private findMatchingParenIndex(
      line: string,
      openIndex: number): number {
        let depth = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        for (let i = openIndex; i < line.length; i++) {
            const ch = line[i];
            const prev = i > 0
              ? line[i - 1]
              : '';
            if (!inDouble
              && !inTemplate
              && ch === "'"
              && !this.isEscaped(
                line,
                i)) {
                inSingle = !inSingle;
                continue;
            }
            if (!inSingle
              && !inTemplate
              && ch === '"'
              && !this.isEscaped(
                line,
                i)) {
                inDouble = !inDouble;
                continue;
            }
            if (!inSingle
              && !inDouble
              && ch === '`'
              && !this.isEscaped(
                line,
                i)) {
                inTemplate = !inTemplate;
                continue;
            }
            if (inSingle
              || inDouble
              || inTemplate) {
                continue;
            }
            if (ch === '(') {
                depth++;
                continue;
            }
            if (ch === ')') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }
    private splitTopLevelLogicalAndOr(
      condition: string,
      parenSplitDepth =
      0,): { parts: string[]; operators: string[] } {
        const parts: string[] = [];
        const operators: string[] = [];
        let current = '';
        let paren = 0;
        let bracket = 0;
        let brace = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        for (let i = 0; i < condition.length; i++) {
            const ch = condition[i];
            const next = i + 1 < condition.length
              ? condition[i + 1]
              : '';
            const prev = i > 0
              ? condition[i - 1]
              : '';
            if (!inDouble
              && !inTemplate
              && ch === "'"
              && !this.isEscaped(
                condition,
                i)) {
                inSingle = !inSingle;
                current += ch;
                continue;
            }
            if (!inSingle
              && !inTemplate
              && ch === '"'
              && !this.isEscaped(
                condition,
                i)) {
                inDouble = !inDouble;
                current += ch;
                continue;
            }
            if (!inSingle
              && !inDouble
              && ch === '`'
              && !this.isEscaped(
                condition,
                i)) {
                inTemplate = !inTemplate;
                current += ch;
                continue;
            }
            if (!inSingle
              && !inDouble
              && !inTemplate) {
                if (ch === '(') {
                    paren++;
                } else if (ch === ')') {
                    paren = Math.max(
                      0,
                      paren - 1);
                } else if (ch === '[') {
                    bracket++;
                } else if (ch === ']') {
                    bracket = Math.max(
                      0,
                      bracket - 1);
                } else if (ch === '{') {
                    brace++;
                } else if (ch === '}') {
                    brace = Math.max(
                      0,
                      brace - 1);
                }
                const isTopLevel =
                  paren <=
                    parenSplitDepth && bracket === 0 && brace === 0;
                if ((ch === '|'
                  && next === '|'
                  && isTopLevel)
                  || (ch === '&' && next === '&' && isTopLevel) ||
                  (ch === '?' && next === '?' && isTopLevel)
        ) {
                    parts.push(current);
                    operators.push(
                      ch === '|'
                        ? '||'
                        : ch === '&'
                          ? '&&'
                          : '??',);
                    current = '';
                    i++;
                    continue;
                }
            }
            current += ch;
        }
        if (current) {
            parts.push(current);
        }
        return {
            parts,
            operators
        };
    }
    private ruleAssignmentWrapping(lines: string[]): string[] {
        const output = [...lines];
        for (let i = 0; i < output.length; i++) {
            const line = output[i];
            if (this.shouldSkipLineTransforms(line)) {
                continue;
            }
            const trimmed = line.trim();
            if (/^[^=]*=[^=].*$/.test(trimmed) &&
              line.length > this.config.maxLineLength &&
              !trimmed.endsWith('=')
      ) {
                const firstEq = line.indexOf('=');
                if (firstEq > -1) {
                    const left = line.slice(
                      0,
                      firstEq + 1)
                      .trimEnd();
                    const right = line.slice(firstEq + 1)
                      .trim();
                    if (right) {
                        const baseIndent = line.match(/^\s*/)?.[0]
                          ?? '';
                        output[i] = left;
                        output.splice(
                          i + 1,
                          0,
                          `${baseIndent}${this.continuationUnit()}${right}`,);
                        i++;
                        continue;
                    }
                }
            }
            if (!trimmed.endsWith('=')
              || i + 1 >= output.length) {
                continue;
            }
            const next = output[i + 1];
            if (!next.trim()) {
                continue;
            }
            const baseIndent = line.match(/^\s*/)?.[0]
              ?? '';
            output[i + 1] =
              `${baseIndent}${this.continuationUnit()}${next
              .trimStart()}`;
        }
        return output;
    }
    private isEscaped(
      text: string,
      index: number): boolean {
        let backslashCount = 0;
        for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }
    private continuationUnit(): string {
        return ' '.repeat(this.config.continuationIndent);
    }
    private indentUnit(): string {
        return this.config.insertSpaces
          ? ' '.repeat(this.config.tabSize)
          : '\t';
    }
    private ruleNoBlankLinesInFunctions(lines: string[]): string[] {
        const sourceCode = lines.join('\n');
        let sourceFile: ts.SourceFile;
        try {
            sourceFile = ts.createSourceFile(
              'file.ts',
              sourceCode,
              ts.ScriptTarget.Latest,
              true,
              scriptKind(this.languageId));
        } catch {
            return lines;
        }
        const functionBodyRanges: Array<{ start: number; end: number }> =
          [];
        const literalPreserveRanges: Array<{ start: number; end: number }> =
          [];
        const visit = (node: ts.Node) => {
            if (ts.isFunctionDeclaration(node) ||
              ts.isMethodDeclaration(node) ||
              ts.isConstructorDeclaration(node) ||
              ts.isGetAccessor(node) ||
              ts.isSetAccessor(node) ||
              ts.isFunctionExpression(node) ||
              ts.isArrowFunction(node)
      ) {
                if (node.body
                  && ts.isBlock(node.body)) {
                    functionBodyRanges.push(
                      {
                          start: node.body.getStart(sourceFile),
                          end: node.body.getEnd(),
                      });
                }
            }
            if (ts.isNoSubstitutionTemplateLiteral(node) ||
              ts.isTemplateHead(node) ||
              ts.isTemplateMiddle(node) ||
              ts.isTemplateTail(node) ||
              ts.isStringLiteral(node)
      ) {
                literalPreserveRanges.push(
                  {
                      start: node.getStart(sourceFile),
                      end: node.getEnd(),
                  });
            }
            ts.forEachChild(
              node,
              visit);
        };
        visit(sourceFile);
        if (functionBodyRanges.length === 0) {
            return lines;
        }
        const isInsideFunctionBody = (pos: number): boolean => {
            return functionBodyRanges.some(
              (r) => pos > r.start && pos < r.end);
        };
        const isInsideLiteral = (pos: number): boolean => {
            return literalPreserveRanges.some(
              (r) => pos >= r.start && pos <= r.end);
        };
        const output: string[] = [];
        let currentPos = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineStartPos = currentPos;
            const lineEndPos = currentPos + line.length;
            currentPos = lineEndPos + 1;
            if (line.trim() === '') {
                const lineMidPos = lineStartPos;
                if (isInsideFunctionBody(lineMidPos)
                  && !isInsideLiteral(lineMidPos)) {
                    continue;
                }
            }
            output.push(line);
        }
        return output;
    }
}
