import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import { TsFormatter } from '../../formatter/TsFormatter';
import { getFormatterConfig } from '../../formatter/FormattingConfig';

describe(
  'A JS/TS Formatter E2E Safety Suite',
  () => {
      const formatTs = async (
        code: string,
        maxLineLength = 80): Promise<string> => {
          const config = getFormatterConfig();
          // Existing fixtures exercise an explicit custom 2/4 indentation profile.
          config.tabSize = 2;
          config.continuationIndent = 4;
          config.maxLineLength = maxLineLength;
          const formatter = new TsFormatter(config);
          return formatter.formatDocument(
            code,
            'typescript');
      };
      const formatRepeatedly = async (
        code: string,
        maxLineLength: number,
        passes: number,): Promise<string> => {
          let current = code;
          for (let i = 0; i < passes; i++) {
              current = await formatTs(
                current,
                maxLineLength);
          }
          return current;
      };
      const assertFormattingChanged = (
        before: string,
        after: string,
        context: string): void => {
          assert.notStrictEqual(
            after,
            before,
            `Expected formatter to change output for ${context}, but it returned original text unchanged.`,);
      };
      const assertTsParseable = (code: string): void => {
          const fileName = 'test.ts';
          const source = ts.createSourceFile(
            fileName,
            code,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS);
          const host: ts.CompilerHost = {
              fileExists: (f) => f === fileName,
              getCanonicalFileName: (f) => f,
              getCurrentDirectory: () => '',
              getDefaultLibFileName: () => 'lib.d.ts',
              getDirectories: () => [],
              getNewLine: () => '\n',
              getSourceFile: (f) => (f === fileName ? source : undefined),
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
            host);
          const diagnostics = program.getSyntacticDiagnostics(source);
          assert.strictEqual(
            diagnostics.length,
            0,
            `Expected valid TypeScript syntax.\nOutput:\n${code}`);
      };
      it(
        'returns original source when rule application does not stabilize within safety limit',
        async () => {
            const config = getFormatterConfig();
            const source = 'const message = "hello";';
            const oscillatingRulesEngine = {
                applyRules: (input: string): string =>
                input.endsWith('//A') ? `${input.slice(
                    0,
                    -3)}//B` : `${input}//A`,
            };
            const permissiveSyntaxValidator = {
                isSyntacticallyValid: (): boolean => true,
            };
            const formatter = new TsFormatter(
              config,
              permissiveSyntaxValidator,
              oscillatingRulesEngine,);
            const output = await formatter.formatDocument(
              source,
              'typescript');
            assert.strictEqual(
              output,
              source,
              'Expected formatter to return original source when rule passes do not stabilize.',);
        });
      it(
        'applies AST-based normalization before rule formatting',
        async () => {
            const input = 'const add=(a:number,b:number)=>{return a+b}';
            const text = await formatTs(
              input,
              80);
            assert.ok(
              text.includes('const add =') && text.includes(
                'a: number') && text.includes(
                'return a + b;'),
              `Expected AST pass to normalize compact TypeScript syntax.\nOutput:\n${text}`,);
        });
      it(
        'wraps statements that exceed 80 columns',
        async () => {
            const input =
              'const veryLongMessage = "This sentence is intentionally long so the line length exceeds eighty columns.";';
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const assignLineIndex = lines.findIndex(
              (line) => line.startsWith(
                'const veryLongMessage ='));
            assert.ok(
              assignLineIndex >= 0,
              `Expected assignment line to be present.\nOutput:\n${text}`);
            assert.strictEqual(
              lines[assignLineIndex],
              'const veryLongMessage =',
              `Expected statement to wrap right after '=' when line exceeds 80 columns.\nOutput:\n${text}`,);
            assert.ok(
              lines[assignLineIndex + 1]?.startsWith(
                '    "This sentence is intentionally long'),
              `Expected wrapped expression to be indented on the next line.\nOutput:\n${text}`,);
        });
      it(
        'wraps short ternary expressions into 3 lines',
        async () => {
            const input = [
            'const result = condition ? onTrue : onFalse;',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const conditionLineIndex = lines.findIndex(
              (line) => line.includes(
                'const result = condition'));
            assert.ok(
              conditionLineIndex >= 0,
              `Expected condition line to exist.\nOutput:\n${text}`);
            assert.strictEqual(
              lines[conditionLineIndex],
              'const result = condition',
              `Expected ternary condition on first line.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[conditionLineIndex + 1],
              '    ? onTrue',
              `Expected ? branch on second line with continuation indentation.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[conditionLineIndex + 2],
              '    : onFalse;',
              `Expected : branch on third line with continuation indentation.\nOutput:\n${text}`,);
        });
      it(
        'wraps every ternary in nested branches and separate call arguments',
        async () => {
            const input = [
            'function select(first: boolean, second: boolean, third: boolean) {',
            '  const nested = first ? second ? "a" : "b" : "c";',
            '  return combine(second ? "left" : "right", third ? "up" : "down");',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            assertTsParseable(text);
            assertFormattingChanged(
              input,
              text,
              'nested and sibling ternaries');
            const parsed = ts.createSourceFile(
              'test.ts',
              text,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS);
            const ternaries: ts.ConditionalExpression[] = [];
            const visit = (node: ts.Node): void => {
                if (ts.isConditionalExpression(node)) ternaries.push(
                  node);
                ts.forEachChild(
                  node,
                  visit);
            };
            visit(parsed);
            assert.strictEqual(
              ternaries.length,
              4,
              `Expected all four ternaries to remain.\nOutput:\n${text}`);
            for (const ternary of ternaries) {
                const conditionLine = parsed.getLineAndCharacterOfPosition(
                  ternary.condition.getEnd())
                  .line;
                const questionLine = parsed.getLineAndCharacterOfPosition(
                  ternary.questionToken.getStart(
                    parsed))
                  .line;
                const trueLine = parsed.getLineAndCharacterOfPosition(
                  ternary.whenTrue.getStart(
                    parsed))
                  .line;
                const colonLine = parsed.getLineAndCharacterOfPosition(
                  ternary.colonToken.getStart(
                    parsed))
                  .line;
                const falseLine = parsed.getLineAndCharacterOfPosition(
                  ternary.whenFalse.getStart(
                    parsed))
                  .line;
                assert.ok(
                  questionLine > conditionLine && trueLine === questionLine && colonLine > questionLine && falseLine === colonLine,
                  `Expected each ternary's condition, ? branch, and : branch on separate lines.\nOutput:\n${text}`);
            }
            assert.strictEqual(
              await formatTs(
                text,
                200),
              text,
              'Expected ternary formatting to stabilize.');
        });
      it(
        'wraps nested false branches, object values, and template expressions through the editor command',
        async function() {
            this.timeout(15000);
            const input = [
            'const fallback = a ? x : b ? y : z;',
            'const data = { left: a ? x : y, right: b ? c : d };',
            'const label = `value: ${flag ? "yes" : "no"}`;',
    ].join('\n');
            const extension = vscode.extensions.getExtension(
              'LemuelAdane.accent-typescript-formatter');
            if (!extension) {
                throw new Error(
                  'Expected the formatter extension to be available.');
            }
            await extension.activate();
            const doc = await vscode.workspace.openTextDocument(
              {
                  content: input,
                  language: 'typescript'
              });
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand(
              'accentTs.format.document');
            const text = doc.getText();
            assertFormattingChanged(
              input,
              text,
              'editor command ternaries');
            assertTsParseable(text);
            const parsed = ts.createSourceFile(
              'test.ts',
              text,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS);
            let count = 0;
            const visit = (node: ts.Node): void => {
                if (ts.isConditionalExpression(node)) {
                    count++;
                    const conditionLine = parsed.getLineAndCharacterOfPosition(
                      node.condition.getEnd())
                      .line;
                    const questionLine = parsed.getLineAndCharacterOfPosition(
                      node.questionToken.getStart(
                        parsed))
                      .line;
                    const trueLine = parsed.getLineAndCharacterOfPosition(
                      node.whenTrue.getEnd())
                      .line;
                    const colonLine = parsed.getLineAndCharacterOfPosition(
                      node.colonToken.getStart(
                        parsed))
                      .line;
                    assert.ok(
                      questionLine > conditionLine && colonLine > trueLine,
                      `Expected every ternary to have dedicated ? and : lines through the editor.\nOutput:\n${text}`);
                }
                ts.forEachChild(
                  node,
                  visit);
            };
            visit(parsed);
            assert.strictEqual(
              count,
              5,
              `Expected five conditional expressions to survive formatting.\nOutput:\n${text}`);
        });
      it(
        'wraps next and prev index ternaries onto condition and branch lines',
        async () => {
            const input = [
            "const next = i + 1 < condition.length ? condition[i + 1] : '';",
            "const prev = i > 0 ? condition[i - 1] : '';",
    ].join('\n');
            const expected = [
            'const next = i + 1 < condition.length',
            '    ? condition[i + 1]',
            "    : '';",
            'const prev = i > 0',
            '    ? condition[i - 1]',
            "    : '';",
    ].join('\n');
            assert.strictEqual(
              await formatTs(
                input,
                120),
              expected);
        });
      it(
        'wraps ternary nested in an arrow callback property value',
        async () => {
            const input = [
            'const host = {',
            '  getSourceFile: (f: string) => (f === fileName ? sourceFile : undefined),',
            '};',
    ].join('\n');
            const expected = [
            'const host = {',
            '  getSourceFile: (f: string) => (f === fileName',
            '      ? sourceFile',
            '      : undefined),',
            '};',
    ].join('\n');
            assert.strictEqual(
              await formatTs(
                input,
                120),
              expected);
        });
      it(
        'keeps ternary branches 2x-indented for fileName assignment pattern',
        async () => {
            const input = [
            'function sample(scriptKind: ts.ScriptKind): string {',
            '  try {',
            '      const fileName = scriptKind === ts.ScriptKind.TSX ? \'file.tsx\' : \'file.ts\';',
            '      return fileName;',
            '  } catch {',
            '      return \'file.ts\';',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const assignmentLineIndex = lines.findIndex(
              (line) =>
              line.includes(
                'const fileName = scriptKind === ts.ScriptKind.TSX'),);
            assert.ok(
              assignmentLineIndex >= 0,
              `Expected assignment line to exist.\nOutput:\n${text}`);
            assert.strictEqual(
              lines[assignmentLineIndex],
              '    const fileName = scriptKind === ts.ScriptKind.TSX',
              `Expected ternary condition to stay on the first line.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[assignmentLineIndex + 1],
              '        ? \'file.tsx\'',
              `Expected ? branch to be 2x-indented.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[assignmentLineIndex + 2],
              '        : \'file.ts\';',
              `Expected : branch to be 2x-indented.\nOutput:\n${text}`,);
        });
      it(
        'keeps max-line-length wrapping as the first rule',
        () => {
            const workspaceRoot = path.resolve(
              __dirname,
              '../../../');
            const rulesEngineSource = fs.readFileSync(
              path.join(
                workspaceRoot,
                'src/formatter/TsRulesEngine.ts'),
              'utf8',);
            const firstRuleMatch = rulesEngineSource.match(
              /createDefaultRules\(\): FormattingRule\[] \{[\s\S]*?return \[[\s\S]*?\{\s*name:\s*'([^']+)'/,);
            assert.ok(
              firstRuleMatch,
              'Expected to detect the first formatter rule in createDefaultRules.');
            assert.strictEqual(
              firstRuleMatch?.[1],
              'maxLineLengthWrapping',
              'Expected max-line-length policy to remain the first formatter rule.',);
        });
      it(
        'set-as-default command uses this extension ID for TypeScript language scopes only',
        async () => {
            const workspaceRoot = path.resolve(
              __dirname,
              '../../../');
            const packageJson = JSON.parse(
              fs.readFileSync(
                path.join(
                  workspaceRoot,
                  'package.json'),
                'utf8'),) as { publisher: string; name: string };
            const expectedId = `${packageJson.publisher}.${packageJson.name}`.toLowerCase();
            const extensionSource = fs.readFileSync(
              path.join(
                workspaceRoot,
                'src/extension.ts'),
              'utf8');
            const wrongId = 'accent.accent-typescript-formatter';
            assert.ok(
              !extensionSource.includes(wrongId),
              `Found incorrect formatter id ${wrongId} in set-as-default command.`,);
            const sourceFile = ts.createSourceFile(
              'extension.ts',
              extensionSource,
              ts.ScriptTarget.Latest,
              true);
            let command: ts.ArrowFunction | undefined;
            const findCommand = (node: ts.Node): void => {
                if (ts.isCallExpression(node)
                  && ts.isPropertyAccessExpression(node.expression)
                  && node.expression.name.text === 'registerCommand'
                  && node.arguments[0]
                  && ts.isStringLiteral(node.arguments[0])
                  && node.arguments[0].text === 'accentTs.format.setAsDefault'
                  && node.arguments[1]
                  && ts.isArrowFunction(node.arguments[1])) {
                    command = node.arguments[1];
                }
                ts.forEachChild(
                  node,
                  findCommand);
            };
            findCommand(sourceFile);
            assert.ok(
              command,
              'Expected set-as-default command to be registered.');
            const extensionIds: string[] = [];
            const updates: string[][] = [];
            const inspectCommand = (node: ts.Node): void => {
                if (ts.isVariableDeclaration(node)
                  && ts.isIdentifier(node.name)
                  && node.name.text === 'extensionId'
                  && node.initializer
                  && ts.isStringLiteral(node.initializer)) {
                    extensionIds.push(node.initializer.text);
                }
                if (ts.isCallExpression(node)
                  && ts.isPropertyAccessExpression(node.expression)
                  && node.expression.name.text === 'update') {
                    const receiver = node.expression.expression;
                    assert.ok(
                      ts.isCallExpression(receiver));
                    assert.ok(
                      ts.isPropertyAccessExpression(
                        receiver.expression));
                    assert.strictEqual(
                      receiver.expression.name.text,
                      'getConfiguration');
                    const scope = receiver.arguments[0];
                    assert.ok(
                      scope && ts.isStringLiteral(scope));
                    updates.push(
                      [
                      scope.text,
                      ...node.arguments.map(
                          argument =>
                        ts.isStringLiteral(argument)
                          ? argument.text
                          : ts.createPrinter()
                            .printNode(
                              ts.EmitHint.Unspecified,
                              argument,
                              sourceFile)),
                    ]);
                }
                ts.forEachChild(
                  node,
                  inspectCommand);
            };
            inspectCommand(command);
            assert.deepStrictEqual(
              extensionIds,
              [expectedId]);
            assert.deepStrictEqual(
              updates,
              [
              ['[typescript]', 'editor.defaultFormatter', 'extensionId',
              'vscode.ConfigurationTarget.Global'],
              ['[typescriptreact]', 'editor.defaultFormatter', 'extensionId',
              'vscode.ConfigurationTarget.Global'],
            ]);
        });
      it(
        'keeps extends/implements on dedicated lines',
        async () => {
            const input = 'export class X extends Base implements Contract {}';
            const text = await formatTs(input);
            assert.ok(
              text.includes('export class X'));
            assert.ok(
              text.includes('extends Base'));
            assert.ok(
              text.includes('implements Contract'));
        });
      it(
        'keeps call/declaration wrapping behavior',
        async () => {
            const input = 'function run(a: string, b: string) { return doWork(a, b); }';
            const text = await formatTs(input);
            assert.ok(
              text.includes('function run('));
            assert.ok(
              text.includes('a: string,'));
            assert.ok(
              text.includes('doWork('));
        });
      it(
        'is idempotent for long decorator arguments',
        async () => {
            const input = [
            '@RequestMapping("/api/products/api/products/api/products/api/products/api/products")',
            'class ProductController {}',
    ].join('\n');
            const firstPass = await formatTs(input);
            const secondPass = await formatTs(firstPass);
            assert.strictEqual(
              secondPass,
              firstPass);
        });
      it(
        'does not corrupt quoted fixture lines containing @ tokens',
        async () => {
            const input = [
            'const fixtures = [',
            "  '@Entity() @Table({ name: \\\"users\\\" })',",
            "  '@Inject() @Named(\\\"service\\\") service!: PaymentService;',",
            '];',
    ].join('\n');
            const text = await formatTs(input);
            assert.ok(
              text.includes('@Entity() @Table('));
            assert.ok(
              text.includes('@Inject() @Named('));
            assert.ok(
              text.includes('service!: PaymentService;'));
            assertTsParseable(text);
        });
      it(
        'wraps long ternary assignment into 3 lines with aligned branches',
        async () => {
            const input = [
            'class V {',
            '  m(scriptKind: any) {',
            "    const fileName = scriptKind === ts.ScriptKind.JS || scriptKind === ts.ScriptKind.JSX ? 'file.js' : 'file.ts';",
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const constLineIndex = lines.findIndex(
              (line) => line.includes(
                'const fileName ='));
            assert.ok(
              constLineIndex >= 0,
              `Expected assignment line to exist.\nOutput:\n${text}`);
            assert.strictEqual(
              lines[constLineIndex],
              '    const fileName =',
              `Expected assignment to break after '=' on first line.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[constLineIndex + 1],
              '        scriptKind === ts.ScriptKind.JS',
              `Expected first logical condition to stay on its own line.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[constLineIndex + 2],
              '            || scriptKind === ts.ScriptKind.JSX',
              `Expected subsequent logical condition to wrap on a new line with 2x continuation indent.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[constLineIndex + 3],
              "            ? 'file.js'",
              `Expected ? branch to be on the next line with 2x continuation indent.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[constLineIndex + 4],
              "            : 'file.ts';",
              `Expected : branch to be on the following line with 2x continuation indent.\nOutput:\n${text}`,);
        });
      it(
        'wraps logical conditions in an already multiline ternary assignment',
        async () => {
            const input = [
            'const fileName =',
            '    scriptKind === ts.ScriptKind.JS || scriptKind === ts.ScriptKind.JSX',
            "        ? 'file.js'",
            "        : 'file.ts';",
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text,
              [
              'const fileName =',
              '    scriptKind === ts.ScriptKind.JS',
              '        || scriptKind === ts.ScriptKind.JSX',
              "        ? 'file.js'",
              "        : 'file.ts';",
      ].join('\n'),);
        });
      it(
        'wraps two-argument method call inside a ternary per argument',
        async () => {
            const input = "const preset = (vscodeConfig ? vscodeConfig.get('preset', 'A Standard') : 'A Standard') as FormatterConfig['preset'];";
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text.trimEnd(),
              "const preset = (vscodeConfig\n    ? vscodeConfig.get(\n        'preset',\n        'A Standard')\n    : 'A Standard') as FormatterConfig['preset'];",
              `Expected the nested two-argument call and ternary to match the requested layout.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'formats the real FormattingConfig source without losing the preset call edit',
        async () => {
            const workspaceRoot = path.resolve(
              __dirname,
              '../../../');
            const source = fs.readFileSync(
              path.join(
                workspaceRoot,
                'src/formatter/FormattingConfig.ts'),
              'utf8',);
            const text = await formatTs(
              source,
              80);
            assert.ok(
              text.includes("vscodeConfig.get(\n") && text.includes(
                "'preset',\n"),
              `Expected the preset method call arguments to be wrapped in the full source.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'remains parseable and stable after repeated runs',
        async () => {
            const input = [
            'class SampleFormatter {',
            '  run(value: string, more: number) {',
            '    const out = mapper.get(value).map((x) => x.trim()).orElseGet(() => fallback(value, more));',
            '    return out.length > 10 ? out.slice(0, 10) : out;',
            '  }',
            '}',
    ].join('\n');
            const firstPass = await formatTs(input);
            const secondPass = await formatTs(firstPass);
            assertTsParseable(firstPass);
            assertTsParseable(secondPass);
            assert.strictEqual(
              secondPass,
              firstPass);
        });
      it(
        'formats long ternary expressions across aligned lines',
        async () => {
            const input = [
            'function withSuffix(basePath: string, normalized: string, fallback: string) {',
            '  return normalized.length > 0 && normalized.startsWith(\'/\') ? `${basePath}${normalized}` : `${basePath}/${fallback}`;',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              60);
            assert.ok(
              text.includes('? `${basePath}${normalized}`'));
            assert.ok(
              text.includes(': `${basePath}/${fallback}`;'));
            assertTsParseable(text);
        });
      it(
        'keeps ternary formatting idempotent',
        async () => {
            const input = [
            'const withSuffix = (basePath: string, normalized: string, fallback: string) => normalized.length > 0 && normalized.startsWith(\'/\') ? `${basePath}${normalized}` : `${basePath}/${fallback}`;',
    ].join('\n');
            const firstPass = await formatTs(
              input,
              60);
            const secondPass = await formatTs(
              firstPass,
              60);
            assert.strictEqual(
              secondPass,
              firstPass);
        });
      it(
        'wraps return ternary with regex and template literals',
        async () => {
            const input = [
            'function withSuffix(base: string, suffix: string): string {',
            "  return /^[;,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            assert.ok(
              text.includes('return /^[;,.!?)}\\]]/.test(suffix)'));
            assert.ok(
              text.includes('? `${base}${suffix}`'));
            assert.ok(
              text.includes(': `${base} ${suffix}`;'));
            assertTsParseable(text);
        });
      it(
        'forces ternary condition onto its own line',
        async () => {
            const input = [
            'function withSuffix(base: string, suffix: string): string {',
            "  return /^[;,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              160);
            const lines = text.split('\n');
            const returnLine = lines.findIndex(
              (line) => line.includes(
                'return /^[;,.!?)}\\]]/.test(suffix)'));
            const qLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  '? `${base}${suffix}`'));
            const cLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  ': `${base} ${suffix}`;'));
            assert.ok(
              returnLine >= 0,
              `Return condition line not found.\nOutput:\n${text}`);
            assert.ok(
              qLine === returnLine + 1,
              `Expected ? line immediately after condition line.\nOutput:\n${text}`);
            assert.ok(
              cLine === qLine + 1,
              `Expected : line immediately after ? line.\nOutput:\n${text}`);
        });
      it(
        'wraps ternary with double-indented branches',
        async () => {
            const input = [
            'class A {',
            '  private withSuffix(base: string, suffix: string): string {',
            '    return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            const returnIndex = lines.findIndex(
              (line) => line.includes(
                'return /^[;:,.!?)}\\]]/.test(suffix)'));
            assert.ok(
              returnIndex >= 0,
              `Expected ternary condition line.\nOutput:\n${text}`);
            assert.strictEqual(
              lines[returnIndex + 1],
              '        ? `${base}${suffix}`',
              `Expected ? branch to be double-indented.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[returnIndex + 2],
              '        : `${base} ${suffix}`;',
              `Expected : branch to be double-indented.\nOutput:\n${text}`,);
        });
      it(
        'keeps strict withSuffix snapshot stable across repeated formatting',
        async () => {
            const input = [
            'class A {',
            "  private withSuffix(base: string, suffix: string): string {",
            '    if (!suffix) {',
            '      return base;',
            '    }',
            "    return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;",
            '  }',
            '}',
    ].join('\n');
            const expected =
              [
              "class A {",
              "  private withSuffix(",
              "      base: string,",
              "      suffix: string): string {",
              "    if (!suffix) {",
              "      return base;",
              "    }",
              "    return /^[;:,.!?)}\\]]/.test(suffix)",
              "        ? `${base}${suffix}`",
              "        : `${base} ${suffix}`;",
              "  }",
              "}",
    ].join('\n');
            const incorrectCollapsed =
              [
              'class A {',
              '  private withSuffix(base: string, suffix: string): string {',
              '    if (!suffix) {',
              '      return base;',
              '    }',
              '    return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;',
              '  }',
              '}',
      ].join('\n');
            const first = await formatTs(
              input,
              120);
            assert.notStrictEqual(
              first,
              incorrectCollapsed,
              `Output unexpectedly matched collapsed single-line form (Photo 1).\nOutput:\n${first}`,);
            assert.strictEqual(
              first,
              expected,
              `Strict withSuffix snapshot mismatch.\nOutput:\n${first}`);
            let stable = first;
            for (let i = 0; i < 10; i++) {
                stable = await formatTs(
                  stable,
                  120);
            }
            assert.strictEqual(
              stable,
              expected,
              `Strict withSuffix snapshot changed after repeated formatting.\nOutput:\n${stable}`,);
            assertTsParseable(stable);
        });
      it(
        'double-indents wrapped method parameters',
        async () => {
            const input = [
            'class A {',
            '  private withSuffix(base: string, suffix: string): string {',
            '    return suffix;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            const baseLine = lines.find(
              (line) => line.includes(
                'base: string,'));
            const suffixLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string'));
            assert.ok(
              baseLine?.startsWith('      '),
              `Expected base param to be double-indented.\nOutput:\n${text}`);
            assert.ok(
              suffixLine?.startsWith('      '),
              `Expected suffix param to be double-indented.\nOutput:\n${text}`);
        });
      it(
        'keeps wrapped method signature aligned and closes with ): return type',
        async () => {
            const input = [
            'class A {',
            '  private withSuffix(base: string, suffix: string): string {',
            "    return /^[;,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;",
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              24);
            assert.ok(
              text.includes('  private withSuffix('),
              `Expected method declaration line to keep class-level indentation.\nOutput:\n${text}`);
            assert.ok(
              text.includes('      base: string,'),
              `Expected wrapped param to be double-indented.\nOutput:\n${text}`);
            assert.ok(
              text.includes('      suffix: string'),
              `Expected wrapped param to be double-indented.\nOutput:\n${text}`);
            assert.ok(
              text.includes('suffix: string): string {'),
              `Expected closing signature line to use "):" without extra space.\nOutput:\n${text}`);
        });
      it(
        'wraps every parameter and closes after the last parameter',
        async () => {
            const input = [
            'export function parseEclipseXmlConfig(filePathOrUrl: string, _profileName?: string, document?: any): Partial<FormatterConfig> {',
            '  return {};',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            const expected = [
            "export function parseEclipseXmlConfig(",
            "    filePathOrUrl: string,",
            "    _profileName?: string,",
            "    document?: any): Partial<FormatterConfig> {",
            "  return {};",
            "}",
    ].join('\n');
            assert.strictEqual(
              text.trimEnd(),
              expected,
              `Expected each parameter on its own line with the closing parenthesis after the last parameter.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'normalizes malformed multiline method signature alignment',
        async () => {
            const input = [
            'class A {',
            '    private withSuffix(',
            '        base: string,',
            '        suffix: string',
            '  ) : string {',
            '    return suffix;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            const methodLine = lines.find(
              (line) => line.includes(
                'private withSuffix('));
            const baseLine = lines.find(
              (line) => line.includes(
                'base: string,'));
            const suffixLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string'));
            const closeLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string') && line.endsWith(
                '): string {'));
            assert.strictEqual(
              methodLine,
              '  private withSuffix(',
              `Expected method line to align at class-member indentation.\nOutput:\n${text}`);
            assert.strictEqual(
              baseLine,
              '      base: string,',
              `Expected parameter line to be double-indented under method line.\nOutput:\n${text}`);
            assert.ok(
              suffixLine?.startsWith('      suffix: string'),
              `Expected aligned final parameter.\nOutput:\n${text}`);
            assert.strictEqual(
              closeLine,
              suffixLine,
              'Expected the closing parenthesis on the final parameter line.');
        });
      it(
        'realigns malformed method signature after previous method block',
        async () => {
            const input = [
            'class Sample {',
            '  private indentUnit(): string {',
            '    return this.config.insertSpaces',
            "      ? ' '.repeat(this.config.tabSize)",
            "      : '\\t';",
            '  }',
            '',
            '    private withSuffix(',
            '        base: string,',
            '        suffix: string,',
            '    ): string {',
            '      return /^[;:,.!?)}\\]]/.test(suffix)',
            '        ? `${base}${suffix}`',
            '        : `${base} ${suffix}`;',
            '    }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            const methodLine = lines.find(
              (line) => line.includes(
                'private withSuffix('));
            const baseLine = lines.find(
              (line) => line.includes(
                'base: string,'));
            const suffixLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string'));
            const closeLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string') && line.endsWith(
                '): string {'));
            assert.strictEqual(
              methodLine,
              '  private withSuffix(',
              `Expected method line to align to class-member indent after reformat.\nOutput:\n${text}`);
            assert.strictEqual(
              baseLine,
              '      base: string,',
              `Expected wrapped params to be double-indented.\nOutput:\n${text}`);
            assert.ok(
              suffixLine?.startsWith('      suffix: string'),
              `Expected aligned final parameter.\nOutput:\n${text}`);
            assert.strictEqual(
              closeLine,
              suffixLine,
              'Expected the closing parenthesis on the final parameter line.');
        });
      it(
        'realigns malformed method signature when previous method contains regex braces',
        async () => {
            const input = [
            'class Sample {',
            '  private hasSuffix(suffix: string): boolean {',
            '    return /^[;:,.!?)}\\]]/.test(suffix);',
            '  }',
            '',
            '    private withSuffix(',
            '        base: string,',
            '        suffix: string,',
            '    ): string {',
            '      return suffix;',
            '    }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            const methodLine = lines.find(
              (line) => line.includes(
                'private withSuffix('));
            const baseLine = lines.find(
              (line) => line.includes(
                'base: string,'));
            const suffixLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string'));
            const closeLine = lines.find(
              (line) => line.trimStart()
                .startsWith('suffix: string') && line.endsWith(
                '): string {'));
            assert.strictEqual(
              methodLine,
              '  private withSuffix(',
              `Expected method line to align to class-member indentation.\nOutput:\n${text}`);
            assert.strictEqual(
              baseLine,
              '      base: string,',
              `Expected wrapped params to be double-indented.\nOutput:\n${text}`);
            assert.ok(
              suffixLine?.startsWith('      suffix: string'),
              `Expected aligned final parameter.\nOutput:\n${text}`);
            assert.strictEqual(
              closeLine,
              suffixLine,
              'Expected the closing parenthesis on the final parameter line.');
        });
      it(
        'wraps if logical-or conditions onto next line with 2x indent',
        async () => {
            const input = [
            'function checkCondition(trimmed: string, line: string): string {',
            "  if (trimmed.startsWith('@') || line.length < this.config.maxLineLength) {",
            '    return line;',
            '  }',
            "  return 'ok';",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const condIndex = lines.findIndex(
              (line) => line.includes(
                "if (trimmed.startsWith('@')"));
            const orIndex = lines.findIndex(
              (line) => line.includes(
                '|| line.length < this.config.maxLineLength) {'));
            assert.ok(
              condIndex >= 0,
              `Expected first condition to remain on if line.\nOutput:\n${text}`);
            assert.ok(
              orIndex === condIndex + 1,
              `Expected || condition on next line.\nOutput:\n${text}`);
            const condLine = lines[condIndex];
            const orLine = lines[orIndex];
            const condIndent = condLine.match(/^\s*/)?.[0].length ?? 0;
            const orIndent = orLine.match(/^\s*/)?.[0].length ?? 0;
            assert.ok(
              orLine.trimStart()
                .startsWith('|| '),
              `Expected || to start the continuation line.\nOutput:\n${text}`);
            assert.strictEqual(
              orIndent,
              condIndent + 4,
              `Expected || line to be indented by 2x (4 spaces) from if line.\nOutput:\n${text}`);
        });
      it(
        'wraps if logical-and conditions onto next line with 2x indent',
        async () => {
            const input = [
            'function checkCondition(trimmed: string, line: string): string {',
            "  if (trimmed.startsWith('@') && line.length < this.config.maxLineLength) {",
            '    return line;',
            '  }',
            "  return 'ok';",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const condIndex = lines.findIndex(
              (line) => line.includes(
                "if (trimmed.startsWith('@')"));
            const andIndex = lines.findIndex(
              (line) => line.includes(
                '&& line.length < this.config.maxLineLength) {'));
            assert.ok(
              condIndex >= 0,
              `Expected first condition to remain on if line.\nOutput:\n${text}`);
            assert.ok(
              andIndex === condIndex + 1,
              `Expected && condition on next line.\nOutput:\n${text}`);
            const condLine = lines[condIndex];
            const andLine = lines[andIndex];
            const condIndent = condLine.match(/^\s*/)?.[0].length ?? 0;
            const andIndent = andLine.match(/^\s*/)?.[0].length ?? 0;
            assert.ok(
              andLine.trimStart()
                .startsWith('&& '),
              `Expected && to start the continuation line.\nOutput:\n${text}`);
            assert.strictEqual(
              andIndent,
              condIndent + 4,
              `Expected && line to be indented by 2x (4 spaces) from if line.\nOutput:\n${text}`);
        });
      it(
        'wraps reported negated if logical-or condition onto next line with 2x indent',
        async () => {
            const input = [
            'function sample(trimmed: string, line: string): string {',
            "  if (!trimmed.startsWith('@') || line.length < this.config.maxLineLength) {",
            "    return 'skip';",
            '  }',
            "  return 'ok';",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const condIndex = lines.findIndex(
              (line) => line.includes(
                "if (!trimmed.startsWith('@')"));
            const orIndex = lines.findIndex(
              (line) => line.includes(
                '|| line.length < this.config.maxLineLength) {'));
            assert.ok(
              condIndex >= 0,
              `Expected first negated condition to remain on if line.\nOutput:\n${text}`);
            assert.ok(
              orIndex === condIndex + 1,
              `Expected || condition on next line.\nOutput:\n${text}`);
            const condIndent = lines[condIndex].match(/^\s*/)?.[0].length ?? 0;
            const orIndent = lines[orIndex].match(/^\s*/)?.[0].length ?? 0;
            assert.strictEqual(
              orIndent,
              condIndent + 4,
              `Expected || line to be indented by 2x (4 spaces) from if line.\nOutput:\n${text}`);
        });
      it(
        'forces multiline ternary when condition contains regex colon and question chars',
        async () => {
            const input = [
            'function withSuffix(base: string, suffix: string): string {',
            "  return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const returnLine = lines.findIndex(
              (line) => line.includes(
                'return /^[;:,.!?)}\\]]/.test(suffix)'));
            const qLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  '? `${base}${suffix}`'));
            const cLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  ': `${base} ${suffix}`;'));
            assert.ok(
              returnLine >= 0,
              `Expected ternary condition line.\nOutput:\n${text}`);
            assert.ok(
              qLine === returnLine + 1,
              `Expected ? branch on next line.\nOutput:\n${text}`);
            assert.ok(
              cLine === qLine + 1,
              `Expected : branch after ? branch.\nOutput:\n${text}`);
        });
      it(
        'wraps logical-and chain with escaped quote and backslash comparisons',
        async () => {
            const input = [
            'function parse(ch: string, prev: string, inDouble: boolean, inTemplate: boolean, inSingle: boolean) {',
            "  if (!inDouble && !inTemplate && ch === '\"' && prev !== '\\\\') {",
            '    inSingle = !inSingle;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const condIndex = lines.findIndex(
              (line) => line.includes(
                'if (!inDouble'));
            const and1 = lines.findIndex(
              (line) => line.includes(
                '&& !inTemplate'));
            const and2 = lines.findIndex(
              (line) => line.includes(
                "&& ch === '\"'"));
            const and3 = lines.findIndex(
              (line) => line.includes(
                "&& prev !== '\\\\') {"));
            assert.ok(
              condIndex >= 0,
              `Expected first condition to remain on if line.\nOutput:\n${text}`);
            assert.ok(
              and1 === condIndex + 1,
              `Expected 2nd condition on next line.\nOutput:\n${text}`);
            assert.ok(
              and2 === and1 + 1,
              `Expected 3rd condition on next line.\nOutput:\n${text}`);
            assert.ok(
              and3 === and2 + 1,
              `Expected 4th condition on next line.\nOutput:\n${text}`);
        });
      it(
        'wraps nullish-coalescing operands with 2x continuation indentation',
        async () => {
            const input = [
            'const value = primary ?? fallback ?? defaultValue;',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text.trimEnd(),
              [
              'const value = primary',
              '    ?? fallback',
              '    ?? defaultValue;',
      ].join('\n'),
              `Expected nullish-coalescing operands to wrap with 2x continuation indentation.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'wraps nested nullish-coalescing operands inside parentheses',
        async () => {
            const input = "const setting = (configuration.get('primary') ?? configuration.get('fallback'));";
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text.trimEnd(),
              [
              "const setting = (configuration.get('primary')",
              "    ?? configuration.get('fallback'));",
      ].join('\n'),
              `Expected nested nullish-coalescing operands to wrap with 2x continuation indentation.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'wraps nullish coalescing at each nesting depth in ternary config values',
        async () => {
            const input = [
            'const config = {',
            '    trailingComma: vscodeConfig ? vscodeConfig.get(',
            "        'trailingComma',",
            "        basePreset.trailingComma ?? 'all') : (",
            "            basePreset.trailingComma ?? 'all'),",
            '};',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text.trimEnd(),
              "const config = {\n  trailingComma: vscodeConfig\n      ? vscodeConfig.get(\n          'trailingComma',\n          basePreset.trailingComma\n              ?? 'all')\n      : (\n          basePreset.trailingComma\n              ?? 'all'),\n};",
              `Expected nested nullish operators to wrap independently with 2x indentation.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'aligns ternary branches around a nullish-coalescing fallback',
        async () => {
            const input = [
            '    formatComments: vscodeConfig',
            '        ? vscodeConfig.get(',
            "            'comments.enabled',",
            '            basePreset.formatComments',
            '                ?? true)',
            '                : (basePreset.formatComments',
            '            ?? true),',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            assert.strictEqual(
              text.trimEnd(),
              [
              '    formatComments: vscodeConfig',
              '        ? vscodeConfig.get(',
              "            'comments.enabled',",
              '            basePreset.formatComments',
              '                ?? true)',
              '        : (basePreset.formatComments',
              '            ?? true),',
      ].join('\n'),
              `Expected the : branch to align with ? while keeping the nullish continuation indented.\nOutput:\n${text}`,);
        });
      it(
        'wraps else-if logical-and condition onto next line with 2x indent',
        async () => {
            const input = [
            'function parse(ch: string, prev: string, inDouble: boolean, inTemplate: boolean, inSingle: boolean) {',
            "  if (!inDouble) {",
            '    inSingle = !inSingle;',
            "  } else if (!inSingle && !inTemplate && ch === '\"' && prev !== '\\\\') {",
            '    inDouble = !inDouble;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              200);
            const lines = text.split('\n');
            const condIndex = lines.findIndex(
              (line) => line.includes(
                "} else if (!inSingle"));
            const and1 = lines.findIndex(
              (line) => line.includes(
                '&& !inTemplate'));
            const and2 = lines.findIndex(
              (line) => line.includes(
                "&& ch === '\"'"));
            const and3 = lines.findIndex(
              (line) => line.includes(
                "&& prev !== '\\\\') {"));
            assert.ok(
              condIndex >= 0,
              `Expected else-if condition start line.\nOutput:\n${text}`);
            assert.ok(
              and1 === condIndex + 1,
              `Expected 2nd else-if condition on next line.\nOutput:\n${text}`);
            assert.ok(
              and2 === and1 + 1,
              `Expected 3rd else-if condition on next line.\nOutput:\n${text}`);
            assert.ok(
              and3 === and2 + 1,
              `Expected 4th else-if condition on next line.\nOutput:\n${text}`);
        });
      it(
        'lifts first multiline if condition to the if line when under max length',
        async () => {
            const input = [
            'function parse(ch: string, inSingle: boolean, inDouble: boolean, inTemplate: boolean, paren: number, bracket: number, brace: number, angle: number) {',
            '  if (',
            "    ch === ',' &&",
            '    !inSingle &&',
            '    !inDouble &&',
            '    !inTemplate &&',
            '    paren === 0 &&',
            '    bracket === 0 &&',
            '    brace === 0 &&',
            '    angle === 0',
            '  ) {',
            "    return 'ok';",
            '  }',
            "  return 'done';",
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const firstIfLine = lines.find(
              (line) => line.includes(
                "if (ch === ',' &&"));
            const multiLineFallback = lines.find(
              (line) => line.trim() === 'if (');
            assert.ok(
              firstIfLine || multiLineFallback,
              `Expected either lifted first condition or stable multiline if block.\nOutput:\n${text}`);
        });
      it(
        'keeps multiline ternary in source-like snippet after stabilization',
        async () => {
            const input = [
            'class Sample {',
            '  private indentUnit(): string {',
            '    return this.config.insertSpaces',
            "      ? ' '.repeat(this.config.tabSize)",
            "      : '\\t';",
            '  }',
            '',
            '    private withSuffix(',
            '        base: string,',
            '        suffix: string,',
            '    ): string {',
            '    if (!suffix) {',
            '      return base;',
            '    }',
            "    if (!trimmed.startsWith('@') || line.length < this.config.maxLineLength) {",
            "      return 'skip';",
            '    }',
            '    return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;',
            '    }',
            '}',
    ].join('\n');
            const first = await formatTs(
              input,
              100);
            const second = await formatTs(
              first,
              100);
            const lines = first.split('\n');
            const returnLine = lines.findIndex(
              (line) => line.includes(
                'return /^[;:,.!?)}\\]]/.test(suffix)'));
            const qLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  '? `${base}${suffix}`'));
            const cLine = lines.findIndex(
              (line) => line.trimStart()
                .startsWith(
                  ': `${base} ${suffix}`;'));
            assert.ok(
              returnLine >= 0,
              `Expected ternary condition line in stabilized output.\nOutput:\n${first}`);
            assert.ok(
              qLine === returnLine + 1,
              `Expected ? branch on next line in stabilized output.\nOutput:\n${first}`);
            assert.ok(
              cLine === qLine + 1,
              `Expected : branch after ? branch in stabilized output.\nOutput:\n${first}`);
            assert.strictEqual(
              second,
              first,
              'Expected stabilized output to be idempotent on second format run.');
        });
      it(
        'wraps each logical condition onto its own indented line',
        async () => {
            const input = [
            'function parse(line: string, i: number, ch: string, inSingle: boolean, inDouble: boolean, inTemplate: boolean) {',
            "  if (!inDouble && !inTemplate && ch === '\"' && !this.isEscaped(line, i)) {",
            '    inSingle = !inSingle;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const conditionLines = [
            '  if (!inDouble',
            '      && !inTemplate',
            `      && ch === '\"'`,
            '      && !this.isEscaped(',
            '          line,',
            '          i)) {',
    ];
            const brokenArgLine = lines.find(
              (line) => line.trim() === 'line,' || line.trim() === 'i)');
            assert.ok(
              text.includes(
                conditionLines.join('\n')),
              `Expected one logical condition per line with two-level continuation indentation.\nOutput:\n${text}`,);
            assert.ok(
              brokenArgLine,
              'Expected nested call arguments to wrap independently.');
        });
      it(
        'wraps each quote comparison onto its own indented condition line',
        async () => {
            const input = [
            'function scan(ch: string): void {',
            "  if (ch === \"'\" || ch === '\"' || ch === '`') {",
            '    return;',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const lines = text.split('\n');
            assert.deepStrictEqual(
              lines.slice(
                1,
                4),
              [
              "  if (ch === \"'\"",
              "      || ch === '\"'",
              "      || ch === '`') {",
      ],
              `Expected one quote comparison per line with two-level continuation indentation.\nOutput:\n${text}`,);
        });
      it(
        'normalizes an over-indented sibling declaration from its containing block',
        async () => {
            const input = [
            'function makeIndents(indent: string, indentUnit: () => string): string[] {',
            '  if (indent) {',
            '    const ternaryIndent = `${indent}${indentUnit()',
            '      .repeat(3)}`;',
            '            const argumentIndent = `${indent}${indentUnit()',
            '      .repeat(6)}`;',
            '    return [ternaryIndent, argumentIndent];',
            '  }',
            '  return [];',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              120);
            const declarations = text.split('\n')
              .filter(
                (line) =>
                line.includes('const ternaryIndent =') || line.includes(
                  'const argumentIndent ='),);
            assert.deepStrictEqual(
              declarations,
              [
              '    const ternaryIndent = `${indent}${indentUnit()',
              '    const argumentIndent = `${indent}${indentUnit()',
      ],
              `Expected sibling declarations to align with their containing block, not expression continuations.\nOutput:\n${text}`,);
            assertTsParseable(text);
        });
      it(
        'formats quote conditions in TsRulesEngine without rejecting the full file',
        async function() {
            this.timeout(15000);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            assert.ok(
              workspaceRoot,
              'Expected the extension test workspace to be available.');
            const sourcePath = path.join(
              workspaceRoot,
              'src',
              'formatter',
              'TsRulesEngine.ts');
            const input = fs.readFileSync(
              sourcePath,
              'utf8');
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const quoteConditionIndex = lines.findIndex(
              (line) => line.trim() === `if (ch === "'"`);
            assert.ok(
              quoteConditionIndex >= 0,
              `Expected full-file formatting to preserve and wrap the quote condition.\nOutput:\n${text}`,);
            assert.strictEqual(
              lines[quoteConditionIndex + 1]?.trim(),
              `|| ch === '"'`);
            assert.strictEqual(
              lines[quoteConditionIndex + 2]?.trim(),
              "|| ch === '`') {");
            assertTsParseable(text);
        });
      it(
        'keeps a fitting single-parameter declaration compact with a complex return type',
        async () => {
            const input = [
            'class Sample {',
            '  private splitTopLevelLogicalAndOr(condition: string): { parts: string[]; operators: string[] } {',
            '    return { parts: [], operators: [] };',
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              100);
            const lines = text.split('\n');
            const methodLine = lines.find(
              (line) => line.includes(
                'private splitTopLevelLogicalAndOr('));
            const paramLine = lines.find(
              (line) => line.includes(
                'condition: string'));
            assert.strictEqual(
              methodLine,
              '  private splitTopLevelLogicalAndOr(condition: string): { parts: string[]; operators: string[] } {');
            assert.strictEqual(
              paramLine,
              methodLine);
            assertTsParseable(text);
        });
      it(
        'does not chain-break method calls inside if logical condition blocks',
        async () => {
            const input = [
            'function sample(trimmed: string): void {',
            "  if ((trimmed.startsWith('return ') || trimmed.includes(' = ')) && this.countChainDots(trimmed) >= 2) {",
            "    return;",
            '  }',
            '}',
    ].join('\n');
            const text = await formatTs(
              input,
              80);
            const lines = text.split('\n');
            const ifLine = lines.find(
              (line) => line.includes(
                "if ((trimmed.startsWith('return ')"));
            const dotChainLine = lines.find(
              (line) => line.trimStart()
                .startsWith('.includes('));
            assert.ok(
              ifLine,
              `Expected first condition to remain on if line.\nOutput:\n${text}`);
            assert.ok(
              !dotChainLine,
              `Did not expect condition to be converted into dot-chain style continuation.\nOutput:\n${text}`);
        });
      it(
        'stays idempotent across strict regression fixtures over many passes',
        async () => {
            const fixtures: Array<{ name: string; maxLineLength: number; input: string }> = [
            {
                name: 'withSuffix signature + ternary snapshot',
                maxLineLength: 120,
                input: [
                'class A {',
                '  private withSuffix(base: string, suffix: string): string {',
                '    if (!suffix) {',
                '      return base;',
                '    }',
                '    return /^[;:,.!?)}\\]]/.test(suffix) ? `${base}${suffix}` : `${base} ${suffix}`;',
                '  }',
                '}',
        ].join('\n'),
            },
            {
                name: 'if logical continuation with method call',
                maxLineLength: 80,
                input: [
                'function parse(line: string, i: number, ch: string, inSingle: boolean, inDouble: boolean, inTemplate: boolean) {',
                "  if (!inDouble && !inTemplate && ch === '\"' && !this.isEscaped(line, i)) {",
                '    inSingle = !inSingle;',
                '  }',
                '}',
        ].join('\n'),
            },
            {
                name: 'declaration with complex return type',
                maxLineLength: 100,
                input: [
                'class Sample {',
                '  private splitTopLevelLogicalAndOr(condition: string): { parts: string[]; operators: string[] } {',
                '    return { parts: [], operators: [] };',
                '  }',
                '}',
        ].join('\n'),
            },
    ];
            for (const fixture of fixtures) {
                const once = await formatTs(
                  fixture.input,
                  fixture.maxLineLength);
                const repeated = await formatRepeatedly(
                  once,
                  fixture.maxLineLength,
                  15);
                assert.strictEqual(
                  repeated,
                  once,
                  `Fixture changed after repeated formatting: ${fixture.name}\nOutput:\n${repeated}`,);
                assertTsParseable(repeated);
            }
        });
      it(
        'generates and parses Eclipse XML configuration profile correctly',
        () => {
            const { generateFormatterXmlConfig, parseEclipseXmlConfig }
              = require(
                '../../formatter/FormattingConfig');
            const xmlContent = generateFormatterXmlConfig();
            assert.ok(
              xmlContent.includes('A Standard TypeScript Profile'),
              'Expected XML profile name to be present');
            const tempXmlPath = path.join(
              __dirname,
              'temp_test_config.xml');
            fs.writeFileSync(
              tempXmlPath,
              xmlContent,
              'utf8');
            try {
                const parsed = parseEclipseXmlConfig(tempXmlPath);
                assert.strictEqual(
                  parsed.tabSize,
                  4,
                  'Expected tabSize = 4 from XML');
                assert.strictEqual(
                  parsed.continuationIndent,
                  2);
                assert.strictEqual(
                  parsed.insertSpaces,
                  true,
                  'Expected insertSpaces = true from XML');
                assert.strictEqual(
                  parsed.maxLineLength,
                  70,
                  'Expected maxLineLength = 70 from XML');
            } finally {
                if (fs.existsSync(tempXmlPath)) {
                    fs.unlinkSync(tempXmlPath);
                }
            }
        });
      it(
        'removes blank line gaps inside method or function bodies',
        async () => {
            const input = [
            'class SampleService {',
            '  public async executeTask(): Promise<void> {',
            '',
            '    const step1 = await this.doStep1();',
            '',
            '    if (!step1) {',
            '',
            '      return;',
            '',
            '    }',
            '',
            '    await this.doStep2();',
            '  }',
            '}',
    ].join('\n');
            const expected = [
            'class SampleService {',
            '  public async executeTask(): Promise<void> {',
            '    const step1 = await this.doStep1();',
            '    if (!step1) {',
            '      return;',
            '    }',
            '    await this.doStep2();',
            '  }',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              100);
            assert.strictEqual(
              formatted,
              expected,
              `Expected blank line gaps inside method body to be removed.\nOutput:\n${formatted}`);
        });
      it(
        'formats call arguments and object argument matching user photo specification',
        async () => {
            const input = [
            'const sourceFile = ts.createSourceFile(',
            '  fileName,',
            '  sourceCode,',
            '  ts.ScriptTarget.Latest,',
            '  true,',
            '  scriptKind,',
            ');',
            'const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });',
    ].join('\n');
            const expected = [
            "const sourceFile = ts.createSourceFile(",
            "    fileName,",
            "    sourceCode,",
            "    ts.ScriptTarget.Latest,",
            "    true,",
            "    scriptKind,);",
            "const printer = ts.createPrinter({",
            "  newLine: ts.NewLineKind.LineFeed",
            "});",
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected,
              `Expected call arguments and object literal argument to match Photo 2 specification.\nOutput:\n${formatted}`,);
        });
      it(
        'provides non-empty TextEdits via FormattingEditProvider for document formatting',
        async () => {
            const { FormattingEditProvider } = require(
              '../../providers/FormattingEditProvider');
            const provider = new FormattingEditProvider();
            const input = 'const add=(a:number,b:number)=>{return a+b}';
            const mockDoc = {
                getText: () => input,
                languageId: 'typescript',
                uri: {
                    fsPath: '/test/sample.ts'
                },
                positionAt: (offset: number) => ({
                    line: 0,
                    character: offset
                }),
                offsetAt: (
                  position: { line: number; character: number }) => input.split(
                  '\n')
                  .slice(
                    0,
                    position.line)
                  .reduce(
                    (
                      offset,
                      line) => offset + line.length + 1,
                    0) + position.character,
            };
            const options = {
                tabSize: 2,
                insertSpaces: true
            };
            const cancellationToken = {} as any;
            const edits = await provider.provideDocumentFormattingEdits(
              mockDoc,
              options,
              cancellationToken);
            assert.ok(
              edits.length > 0,
              'Expected FormattingEditProvider to return non-empty TextEdits when document needs formatting.');
            assert.ok(
              edits[0].newText.includes('const add ='),
              'Expected formatted output in TextEdit replacement text.');
        });
      it(
        'provides range-scoped TextEdits via FormattingEditProvider for document range formatting',
        async () => {
            const { FormattingEditProvider } = require(
              '../../providers/FormattingEditProvider');
            const provider = new FormattingEditProvider();
            const input = [
            'function test() {',
            '  const candidateDiagnostics = this.getDiagnostics(sourceCode, languageId);',
            '}',
    ].join('\n');
            const mockDoc = {
                getText: (range?: any) => {
                    if (!range) return input;
                    const lines = input.split('\n');
                    return lines.slice(
                      range.start.line,
                      range.end.line + 1)
                      .join('\n');
                },
                lineAt: (lineNum: number) => {
                    const lines = input.split('\n');
                    return {
                        range: {
                            end: {
                                line: lineNum,
                                character: lines[lineNum].length
                            }
                        }
                    };
                },
                languageId: 'typescript',
                uri: {
                    fsPath: '/test/sample.ts'
                },
                positionAt: (offset: number) => ({
                    line: 0,
                    character: offset
                }),
                offsetAt: (
                  position: { line: number; character: number }) => input.split(
                  '\n')
                  .slice(
                    0,
                    position.line)
                  .reduce(
                    (
                      offset,
                      line) => offset + line.length + 1,
                    0) + position.character,
            };
            const range = {
                start: {
                    line: 1,
                    character: 0
                },
                end: {
                    line: 1,
                    character: 75
                }
            };
            const options = {
                tabSize: 2,
                insertSpaces: true
            };
            const cancellationToken = {} as any;
            const edits = await provider.provideDocumentRangeFormattingEdits(
              mockDoc,
              range,
              options,
              cancellationToken);
            assert.ok(
              edits.length > 0,
              'Expected range formatting to return non-empty edits.');
            assert.strictEqual(
              edits[0].range.start.line,
              1,
              'Expected edit range start line to match selection range start.');
            assert.ok(
              edits[0].newText.includes('sourceCode,'),
              'Expected formatted text inside range edit.');
        });
      it(
        'formats indented Photo 1 code to Photo 2 block structure',
        async () => {
            const input = [
            'function formatFile() {',
            '  const sourceFile = ts.createSourceFile(',
            '    fileName,',
            '    sourceCode,',
            '    ts.ScriptTarget.Latest,',
            '    true,',
            '    scriptKind,',
            '  );',
            '  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });',
            '  return printer.printFile(sourceFile);',
            '}',
    ].join('\n');
            const expected = [
            "function formatFile() {",
            "  const sourceFile = ts.createSourceFile(",
            "      fileName,",
            "      sourceCode,",
            "      ts.ScriptTarget.Latest,",
            "      true,",
            "      scriptKind,);",
            "  const printer = ts.createPrinter({",
            "    newLine: ts.NewLineKind.LineFeed",
            "  });",
            "  return printer.printFile(sourceFile);",
            "}",
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected,
              `Expected indented Photo 1 snippet to format into Photo 2 block structure.\nOutput:\n${formatted}`,);
        });
      it(
        'formats standalone Photo 1 snippet containing pre-existing syntax diagnostics without rejecting edits',
        async () => {
            const input = [
            '  ),',
            '  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });',
            '  return printer.printFile(sourceFile);',
    ].join('\n');
            const expected = [
            "  ),",
            "  const printer = ts.createPrinter({",
            "    newLine: ts.NewLineKind.LineFeed",
            "  });",
            "  return printer.printFile(sourceFile);",
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected,
              `Expected standalone Photo 1 snippet with pre-existing diagnostics to format properly into Photo 2 block structure.\nOutput:\n${formatted}`,);
        });
      it(
        'wraps and 2x indents function call with 2 or more arguments when args start on call line',
        async () => {
            const input = [
            'function test() {',
            '  const sourceFile = ts.createSourceFile(fileName,',
            '    sourceCode,',
            '    ts.ScriptTarget.Latest,',
            '    true,',
            '    scriptKind',
            '  );',
            '}',
    ].join('\n');
            const expected = [
            'function test() {',
            '  const sourceFile = ts.createSourceFile(',
            '      fileName,',
            '      sourceCode,',
            '      ts.ScriptTarget.Latest,',
            '      true,',
            '      scriptKind);',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected);
        });
      it(
        'wraps and 2x indents single-line method call with 2 or more arguments',
        async () => {
            const input = [
            'function test() {',
            '  console.log("User:", user.name);',
            '}',
    ].join('\n');
            const expected = [
            'function test() {',
            '  console.log(',
            '      "User:",',
            '      user.name);',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected);
        });
      it(
        'wraps every argument of a long call through the editor',
        async function() {
            this.timeout(15000);
            const input = [
            'function test() {',
            "  const parsed = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);",
            '}',
    ].join('\n');
            const expected = [
            "function test() {",
            "    const parsed = ts.createSourceFile(",
            "      'test.ts',",
            "      text,",
            "      ts.ScriptTarget.Latest,",
            "      true,",
            "      ts.ScriptKind.TS);",
            "}",
    ].join('\n');
            const extension = vscode.extensions.getExtension(
              'LemuelAdane.accent-typescript-formatter');
            if (!extension) {
                throw new Error(
                  'Expected the formatter extension to be available.');
            }
            await extension.activate();
            const doc = await vscode.workspace.openTextDocument(
              {
                  content: input,
                  language: 'typescript'
              });
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand(
              'accentTs.format.document');
            assert.strictEqual(
              doc.getText(),
              expected);
            assertTsParseable(
              doc.getText());
            assert.ok(
              doc.getText()
                .split('\n')
                .every(
                  (line) => line.length <= 80));
            assert.strictEqual(
              await new TsFormatter(
                getFormatterConfig()).formatDocument(
                expected,
                'typescript'),
              expected,
              'Expected wrapped call to be stable.');
        });
      it(
        'formats Photo A snippet into Photo B block structure for multi-argument method calls',
        async () => {
            const input = [
            '): boolean {',
            '  const candidateDiagnostics = this.getDiagnostics(sourceCode, languageId);',
            '  if (candidateDiagnostics.length === 0) {',
            '    return true;',
            '  }',
            '',
            '  if (originalSource !== undefined) {',
            '    const originalDiagnostics = this.getDiagnostics(originalSource, languageId);',
            '    return candidateDiagnostics.length <= originalDiagnostics.length;',
            '  }',
            '}',
    ].join('\n');
            const expected = [
            "): boolean {",
            "  const candidateDiagnostics = this.getDiagnostics(",
            "      sourceCode,",
            "      languageId);",
            "  if (candidateDiagnostics.length === 0) {",
            "    return true;",
            "  }",
            "  if (originalSource !== undefined) {",
            "    const originalDiagnostics = this.getDiagnostics(",
            "        originalSource,",
            "        languageId);",
            "    return candidateDiagnostics.length <= originalDiagnostics.length;",
            "  }",
            "}",
    ].join('\n');
            const formatted = await formatTs(
              input,
              80);
            assert.strictEqual(
              formatted,
              expected);
        });
      it(
        'normalizes pre-wrapped 2-argument calls to 2x continuation indentation',
        async () => {
            const input = [
            'class AstSyntaxValidator {',
            '  public isSyntacticallyValid(sourceCode: string, languageId: string, originalSource?: string): boolean {',
            '    const candidateDiagnostics = this.getDiagnostics(',
            '      sourceCode,',
            '      languageId);',
            '    if (originalSource !== undefined) {',
            '      const originalDiagnostics = this.getDiagnostics(',
            '        originalSource,',
            '        languageId);',
            '      return candidateDiagnostics.length <= originalDiagnostics.length;',
            '    }',
            '    return false;',
            '  }',
            '}',
    ].join('\n');
            const expected = [
            "class AstSyntaxValidator {",
            "  public isSyntacticallyValid(",
            "      sourceCode: string,",
            "      languageId: string,",
            "      originalSource?: string): boolean {",
            "    const candidateDiagnostics = this.getDiagnostics(",
            "        sourceCode,",
            "        languageId);",
            "    if (originalSource !== undefined) {",
            "      const originalDiagnostics = this.getDiagnostics(",
            "          originalSource,",
            "          languageId);",
            "      return candidateDiagnostics.length <= originalDiagnostics.length;",
            "    }",
            "    return false;",
            "  }",
            "}",
    ].join('\n');
            const formatted = await formatTs(
              input,
              200);
            assert.strictEqual(
              formatted,
              expected);
        });
      it(
        'wraps 2-argument method calls even when interface method signatures are present',
        async () => {
            const input = [
            'export interface SyntaxValidator {',
            '  isSyntacticallyValid(',
            '    sourceCode: string,',
            '    languageId: string,',
            '    originalSource?: string,',
            '  ): boolean;',
            '}',
            '',
            'export class AstSyntaxValidator implements SyntaxValidator {',
            '  public isSyntacticallyValid(',
            '    sourceCode: string,',
            '    languageId: string,',
            '    originalSource?: string,',
            '  ): boolean {',
            '    const originalDiagnostics = this.getDiagnostics(originalSource, languageId);',
            '    return false;',
            '  }',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              200);
            assert.ok(
              formatted.includes(
                'const originalDiagnostics = this.getDiagnostics('),
              `Expected wrapped call opener in class method.\nOutput:\n${formatted}`,);
            assert.ok(
              formatted.includes(
                '\n        originalSource,\n        languageId);'),
              `Expected per-argument wrapping with 2x indentation for getDiagnostics call.\nOutput:\n${formatted}`,);
            assertTsParseable(formatted);
        });
      it(
        'wraps later 2-argument call when an earlier 2-argument call is already wrapped',
        async () => {
            const input = [
            'export class AstSyntaxValidator {',
            '  public isSyntacticallyValid(sourceCode: string, languageId: string, originalSource?: string): boolean {',
            '    const candidateDiagnostics = this.getDiagnostics(',
            '      sourceCode,',
            '      languageId);',
            '    if (originalSource !== undefined) {',
            '      const originalDiagnostics = this.getDiagnostics(originalSource, languageId);',
            '      return candidateDiagnostics.length <= originalDiagnostics.length;',
            '    }',
            '    return false;',
            '  }',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              200);
            assert.ok(
              formatted.includes(
                'const originalDiagnostics = this.getDiagnostics('),
              `Expected later call to be wrapped.\nOutput:\n${formatted}`,);
            assert.ok(
              formatted.includes(
                '\n          originalSource,\n          languageId);'),
              `Expected later call arguments to be wrapped one-per-line at 2x indent.\nOutput:\n${formatted}`,);
            assert.ok(
              !formatted.includes('languageId);,'),
              `Did not expect trailing-comma corruption after wrapped call.\nOutput:\n${formatted}`,);
            assertTsParseable(formatted);
        });
      it(
        'still wraps 2-argument declarations and calls when file also contains multiline object-literal call arguments',
        async () => {
            const input = [
            'class Example {',
            '  private getDiagnostics(sourceCode: string, languageId: string): readonly ts.Diagnostic[] {',
            '    const candidateDiagnostics = this.getDiagnostics(sourceCode, languageId);',
            '    const program = ts.createProgram(',
            '      [fileName],',
            '      {',
            '        allowJs: true,',
            '        jsx: ts.JsxEmit.Preserve,',
            '        noLib: true,',
            '        target: ts.ScriptTarget.ESNext,',
            '      },',
            '      host,',
            '    );',
            '    return candidateDiagnostics;',
            '  }',
            '}',
    ].join('\n');
            const formatted = await formatTs(
              input,
              200);
            assert.ok(
              formatted.includes('private getDiagnostics('),
              `Expected method declaration to wrap.\nOutput:\n${formatted}`,);
            assert.ok(
              formatted.includes(
                '\n      sourceCode: string,\n      languageId: string): readonly ts.Diagnostic[] {'),
              `Expected 2-argument method declaration to be per-argument wrapped.\nOutput:\n${formatted}`,);
            assert.ok(
              /const candidateDiagnostics =\s+this\.getDiagnostics\(/.test(
                formatted),
              `Expected 2-argument method call to wrap.\nOutput:\n${formatted}`,);
            assert.ok(
              !formatted.includes('{,'),
              `Did not expect object-literal corruption in multiline call arguments.\nOutput:\n${formatted}`,);
            assertTsParseable(formatted);
        });
      it(
        'enforces before-after state change for AstSyntaxValidator-style declaration and call wrapping',
        async () => {
            const input = [
            'class AstSyntaxValidator {',
            '  private getDiagnostics(sourceCode: string, languageId: string): readonly ts.Diagnostic[] {',
            '    const candidateDiagnostics = this.getDiagnostics(sourceCode, languageId);',
            '    const program = ts.createProgram(',
            '      [fileName],',
            '      {',
            '        allowJs: true,',
            '        jsx: ts.JsxEmit.Preserve,',
            '        noLib: true,',
            '        target: ts.ScriptTarget.ESNext,',
            '      },',
            '      host,',
            '    );',
            '    return candidateDiagnostics;',
            '  }',
            '}',
    ].join('\n');
            const expected = [
            "class AstSyntaxValidator {",
            "  private getDiagnostics(",
            "      sourceCode: string,",
            "      languageId: string): readonly ts.Diagnostic[] {",
            "    const candidateDiagnostics = this.getDiagnostics(",
            "        sourceCode,",
            "        languageId);",
            "    const program = ts.createProgram(",
            "        [fileName],",
            "        {",
            "          allowJs: true,",
            "          jsx: ts.JsxEmit.Preserve,",
            "          noLib: true,",
            "          target: ts.ScriptTarget.ESNext,",
            "        },",
            "        host,);",
            "    return candidateDiagnostics;",
            "  }",
            "}",
    ].join('\n');
            const formatted = await formatTs(
              input,
              200);
            assertFormattingChanged(
              input,
              formatted,
              'AstSyntaxValidator-style signature and call wrapping');
            assert.strictEqual(
              formatted,
              expected,
              `Expected exact wrapped output.\nOutput:\n${formatted}`);
            const secondPass = await formatTs(
              formatted,
              200);
            assert.strictEqual(
              secondPass,
              formatted,
              'Expected idempotent output after first formatting pass.');
            assertTsParseable(formatted);
        });
      it(
        'formats through extension command path (real extension host activation)',
        async () => {
            const extensionId = 'LemuelAdane.accent-typescript-formatter';
            const extension = vscode.extensions.getExtension(
              extensionId);
            assert.ok(
              extension,
              `Expected extension ${extensionId} to be available in test host.`);
            await extension?.activate();
            const input = [
            'class AstSyntaxValidator {',
            '  private getDiagnostics(sourceCode: string, languageId: string): readonly ts.Diagnostic[] {',
            '    const candidateDiagnostics = this.getDiagnostics(sourceCode, languageId);',
            '    return candidateDiagnostics;',
            '  }',
            '}',
    ].join('\n');
            const doc = await vscode.workspace.openTextDocument(
              {
                  content: input,
                  language: 'typescript'
              });
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand(
              'accentTs.format.document');
            const formatted = doc.getText();
            assertFormattingChanged(
              input,
              formatted,
              'extension command path formatting');
            assert.ok(
              formatted.includes('private getDiagnostics('),
              `Expected wrapped method declaration through extension command path.\nOutput:\n${formatted}`,);
            assert.ok(
              /const candidateDiagnostics =\s+this\.getDiagnostics\(/.test(
                formatted),
              `Expected wrapped method call through extension command path.\nOutput:\n${formatted}`,);
            assertTsParseable(formatted);
        });
      it(
        'wraps the unchanged quote-check source through the real editor command',
        async function() {
            this.timeout(15000);
            const extension = vscode.extensions.getExtension(
              'LemuelAdane.accent-typescript-formatter');
            assert.ok(
              extension,
              'Expected the formatter extension to be available.');
            await extension.activate();
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            assert.ok(
              workspaceRoot,
              'Expected the extension test workspace to be available.');
            const sourcePath = path.join(
              workspaceRoot,
              'src',
              'formatter',
              'TsRulesEngine.ts');
            const input = fs.readFileSync(
              sourcePath,
              'utf8');
            const quoteCheck = [
            '      if (ch === "\'"',
            '          || ch === \'"\'',
            "          || ch === '`') {",
    ].join('\n');
            const expectedChecks = [
            ["                if (ch === quote", "                  && expression[i - 1] !== '\\\\') {"].join(
              '\n'),
            ['            if (ch === "\'"', '              || ch === \'"\'', "              || ch === '`') {"].join(
              '\n'),
            ["            if (ch === '('", "              || ch === ')') {"].join(
              '\n'),
            ["            if (ch === '?'", "              && expression[i + 1] === '?') {"].join(
              '\n'),
    ];
            assert.ok(
              input.includes(quoteCheck),
              'Expected the source fixture to contain the wrapped quote check.');
            const doc = await vscode.workspace.openTextDocument(
              {
                  content: input,
                  language: 'typescript'
              });
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand(
              'accentTs.format.document');
            for (const expected of expectedChecks) {
                assert.ok(
                  doc.getText()
                    .includes(expected),
                  `The editor command must preserve the wrapped block:\n${expected}`);
            }
            assertTsParseable(
              doc.getText());
        });
  });






describe(
  'Java 0.9.8 layout parity',
  () => {
      it(
        'uses independent four-space blocks and two-space continuations by default',
        async () => {
            const config = getFormatterConfig();
            assert.strictEqual(
              config.tabSize,
              4);
            assert.strictEqual(
              config.maxLineLength,
              70);
            assert.strictEqual(
              (config as any).continuationIndent,
              2);
            const formatter = new TsFormatter(config);
            const input = 'class Sample { run() { send(first, convert(second, third)); } }';
            const expected = 'class Sample {\n    run() {\n        send(\n          first,\n          convert(\n            second,\n            third));\n    }\n}\n';
            const output = await formatter.formatDocument(
              input,
              'typescript');
            assert.strictEqual(
              output,
              expected);
            assert.strictEqual(
              await formatter.formatDocument(
                output,
                'typescript'),
              output);
        });
      it(
        'formats prebroken calls and chains recursively with compact trailing calls',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            const output = await formatter.formatDocument(
              'class Sample { run() { users.query().where(\n"active", "=", false\n).limit(10); } }',
              'typescript');
            assert.strictEqual(
              output.trim(),
              'class Sample {\n    run() {\n        users.query()\n          .where(\n            "active",\n            "=",\n            false)\n          .limit(10);\n    }\n}');
            assert.strictEqual(
              await formatter.formatDocument(
                output,
                'typescript'),
              output);
        });
      it(
        'preserves literal and comment contents while formatting surrounding calls',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            const input = 'function run() {\nconst text = `a {\n  untouched, x.y()\n}`;\n// keep foo(a,b) and x.y().z()\nsend(text, /[{},()]/g);\n}';
            const output = await formatter.formatDocument(
              input,
              'typescript');
            assert.ok(
              output.includes('`a {\n  untouched, x.y()\n}`'));
            assert.ok(
              output.includes('// keep foo(a,b) and x.y().z()'));
            assert.ok(
              output.includes(
                'send(\n      text,\n      /[{},()]/g);'),
              output);
            assert.strictEqual(
              await formatter.formatDocument(
                output,
                'typescript'),
              output);
        });
  });

describe(
  'Structural layout safety and configuration',
  () => {
      it(
        'keeps continuation columns independent of custom block widths and tabs',
        async () => {
            for (const tabSize of [2, 4, 8]) {
                for (const insertSpaces of [true, false]) {
                    const formatter = new TsFormatter(
                      {
                          ...getFormatterConfig(),
                          tabSize,
                          insertSpaces,
                          continuationIndent: 2
                      });
                    const output = await formatter.formatDocument(
                      'function run() { send(first, second); }',
                      'typescript');
                    const indent = (columns: number): string => insertSpaces ? ' '.repeat(
                        columns)
                      : '\t'.repeat(
                        Math.floor(columns / tabSize)) + ' '.repeat(
                        columns % tabSize);
                    assert.strictEqual(
                      output,
                      `function run() {\n${indent(
                        tabSize)}send(\n${indent(
                        tabSize + 2)}first,\n${indent(
                        tabSize + 2)}second);\n}\n`);
                    assert.strictEqual(
                      await formatter.formatDocument(
                        output,
                        'typescript'),
                      output);
                }
            }
        });
      it(
        'keeps closing parentheses outside trailing line comments',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            const output = await formatter.formatDocument(
              'function run() {\nsend(first, second // keep this\n);\n}',
              'typescript');
            assert.ok(
              output.includes(
                'send(\n      first,\n      second // keep this\n'),
              output);
            assert.ok(
              output.includes('\n);') || output.includes('\n    );'),
              output);
            assert.strictEqual(
              await formatter.formatDocument(
                output,
                'typescript'),
              output);
        });
      it(
        'preserves syntax trees for TypeScript, JavaScript, TSX, and JSX',
        async () => {
            for (const [language, input] of [
            ['typescript', 'const identity = <T>(value: T) => value;\nconst x = combine<number>(left < right, other > limit);'],
            ['javascript', 'function run() { return combine(/a,b/g, `x ${value}`); }'],
            ['typescriptreact', 'const element = <div title="a,b"> hello {combine(first, second)} world </div>;'],
            ['javascriptreact', 'const element = <><span>keep  spaces</span>{combine(first, second)}</>;'],
    ]) {
                const formatter = new TsFormatter(
                  getFormatterConfig());
                const output = await formatter.formatDocument(
                  input,
                  language);
                assert.notStrictEqual(
                  output,
                  input,
                  language);
                assert.strictEqual(
                  await formatter.formatDocument(
                    output,
                    language),
                  output,
                  language);
                const validator = new (require(
                  '../../formatter/AstSyntaxValidator')
                  .AstSyntaxValidator)();
                assert.ok(
                  validator.isSyntacticallyValid(
                    output,
                    language,
                    input),
                  output);
            }
        });
      it(
        'rejects a syntactically valid change to program behavior',
        async () => {
            const config = getFormatterConfig();
            const formatter = new TsFormatter(
              config,
              undefined,
              {
                  applyRules: () => 'const result = false;'
              });
            assert.strictEqual(
              await formatter.formatDocument(
                'const result = true;',
                'typescript'),
              'const result = true;');
        });
  });

describe(
  'Selection and line-ending safety',
  () => {
      it(
        'formats only the requested range and preserves surrounding code',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            const source = '// before\nfunction run() { send(first, second); }\nconst after=1;';
            const start = source.indexOf('function');
            const end = source.indexOf('\nconst after');
            const result = await formatter.formatRange(
              source,
              start,
              end,
              'typescript');
            assert.ok(
              result.startsWith('// before\nfunction run() {\n'));
            assert.ok(
              result.endsWith('\nconst after=1;'));
            assert.ok(
              result.includes(
                '    send(\n      first,\n      second);'));
        });
      it(
        'does not interpret a selection inside a template or block comment as code',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            for (const source of ['const text = `hello\n  send(first, second);\nworld`;', '/* hello\n  send(first, second);\nworld */']) {
                const start = source.indexOf('  send');
                const end = source.indexOf('\nworld');
                assert.strictEqual(
                  await formatter.formatRange(
                    source,
                    start,
                    end,
                    'typescript'),
                  source);
            }
        });
      it(
        'preserves CRLF outside literals and exact template contents',
        async () => {
            const source = 'function run() {\r\nconst text = `a\r\n b`;\r\nsend(text, other);\r\n}';
            const formatter = new TsFormatter(
              getFormatterConfig());
            const output = await formatter.formatDocument(
              source,
              'typescript');
            assert.ok(
              output.includes('`a\r\n b`'));
            assert.ok(
              output.includes(
                'send(\r\n      text,\r\n      other);'));
            assert.ok(
              !/(?<!\r)\n/.test(output));
            assert.strictEqual(
              await formatter.formatDocument(
                output,
                'typescript'),
              output);
        });
  });

describe(
  'Java 0.9.9–0.9.10 editor parity',
  () => {
      async function formatInEditor(input: string): Promise<string> {
          const extension = vscode.extensions.getExtension(
            'LemuelAdane.accent-typescript-formatter');
          assert.ok(extension);
          await extension.activate();
          const doc = await vscode.workspace.openTextDocument(
            {
                content: input,
                language: 'typescript'
            });
          await vscode.window.showTextDocument(doc);
          await vscode.commands.executeCommand(
            'accentTs.format.document');
          const output = doc.getText();
          await vscode.commands.executeCommand(
            'accentTs.format.document');
          assert.strictEqual(
            doc.getText(),
            output,
            'Second editor format must preserve layout');
          return output.trimEnd();
      }
      for (const width of [69, 70, 71]) {
          it(
            `counts indentation in a ${width}-column assignment call header`,
            async () => {
                const name = 'startedAt' + 'x'.repeat(
                  width - '        const startedAt = earliest('.length);
                const header = `        const ${name} = earliest(`;
                assert.strictEqual(
                  header.length,
                  width);
                const input = `class Sample {\nrun() {\nconst ${name} = earliest(installedAt, readInstant(KEY_STARTED_AT));\n}\n}`;
                const expected = ['class Sample {', '    run() {',
                ...(width <= 70 ? [header] : [`        const ${name}`, '          = earliest(']),
                `${' '.repeat(width <= 70 ? 10 : 12)}installedAt,`,
                `${' '.repeat(width <= 70 ? 10 : 12)}readInstant(KEY_STARTED_AT));`, '    }', '}'].join(
                  '\n');
                assert.strictEqual(
                  await formatInEditor(input),
                  expected);
            });
      }
      it(
        'rejoins call headers already broken before or after equals',
        async () => {
            const expected = 'function run() {\n    const result = earliest(\n      first,\n      second);\n}';
            for (const assignment of ['const result =\nearliest(first, second);', 'const result\n= earliest(first, second);']) {
                assert.strictEqual(
                  await formatInEditor(
                    `function run() {\n${assignment}\n}`),
                  expected);
            }
        });
      it(
        'keeps nested generic bounds together and wraps actual heritage clauses',
        async () => {
            const input = 'class Sample<T extends Map<string, Array<number>>> extends Base<T> implements Service<T> {\nconvert<U extends Readonly<T>>(value: U): U { return value; }\n}\ntype Choice<T> = T extends string ? T : never;';
            const output = await formatInEditor(input);
            assert.ok(
              output.includes(
                'class Sample<T extends Map<string, Array<number>>>\n  extends Base<T>\n  implements Service<T> {'),
              output);
            assert.ok(
              output.includes(
                'convert<U extends Readonly<T>>(value: U): U {'),
              output);
            assert.ok(
              output.includes('T extends string'),
              output);
        });
  });

describe(
  'Assignment call configuration and safety',
  () => {
      it(
        'uses visual columns with tabs and custom continuation widths for declarations, properties, and assignments',
        async () => {
            for (const insertSpaces of [true, false]) {
                const config = {
                    ...getFormatterConfig(),
                    tabSize: 4,
                    continuationIndent: 3,
                    maxLineLength: 40,
                    insertSpaces
                };
                const indent = (n: number): string => insertSpaces ? ' '.repeat(
                    n) : '\t'.repeat(
                    Math.floor(n / 4)) + ' '.repeat(
                    n % 4);
                for (const lhs of ['const veryLongResultVariable', 'this.veryLongResultVariable']) {
                    const formatter = new TsFormatter(config);
                    const output = await formatter.formatDocument(
                      `function run() {\n${lhs} = new Factory<Type>(first, second);\n}`,
                      'typescript');
                    assert.strictEqual(
                      output.trimEnd(),
                      `function run() {\n${indent(
                        4)}${lhs}\n${indent(
                        7)}= new Factory<Type>(\n${indent(
                        10)}first,\n${indent(
                        10)}second);\n}`);
                    assert.strictEqual(
                      await formatter.formatDocument(
                        output,
                        'typescript'),
                      output);
                }
                const formatter = new TsFormatter(config);
                const output = await formatter.formatDocument(
                  'class Sample {\nprivate veryLongResultVariable = create<Type>(first, second);\n}',
                  'typescript');
                assert.strictEqual(
                  output.trimEnd(),
                  `class Sample {\n${indent(4)}private veryLongResultVariable\n${indent(
                    7)}= create<Type>(\n${indent(
                    10)}first,\n${indent(10)}second);\n}`);
                assert.strictEqual(
                  await formatter.formatDocument(
                    output,
                    'typescript'),
                  output);
            }
        });
      it(
        'preserves comments around assignment operators and does not treat comparisons as assignments',
        async () => {
            const formatter = new TsFormatter(
              getFormatterConfig());
            for (const input of [
            'function run() {\nconst result = // keep here\ncreate(first, second);\n}',
            'function run() {\nconst result /* keep here */ = create(first, second);\n}',
            'function run() {\nreturn value === create(first, second);\n}',
    ]) {
                const output = await formatter.formatDocument(
                  input,
                  'typescript');
                assert.notStrictEqual(
                  output,
                  input);
                if (input.includes('//')) assert.ok(
                  output.includes(
                    '= // keep here\n'),
                  output);
                if (input.includes('/*')) assert.ok(
                  output.includes(
                    '/* keep here */ = create('),
                  output);
                if (input.includes('===')) assert.ok(
                  output.includes(
                    'value === create('),
                  output);
                assert.strictEqual(
                  await formatter.formatDocument(
                    output,
                    'typescript'),
                  output);
            }
        });
  });
