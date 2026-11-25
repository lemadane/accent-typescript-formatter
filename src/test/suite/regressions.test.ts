import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TsFormatter } from '../../formatter/TsFormatter';
import { getFormatterConfig, parseEclipseXmlConfig } from '../../formatter/FormattingConfig';
import { AstSyntaxValidator } from '../../formatter/AstSyntaxValidator';
import { FormattingEditProvider } from '../../providers/FormattingEditProvider';
import { CodeActionProvider } from '../../providers/CodeActionProvider';

async function withSettings(
  values: Record<string, unknown>,
  run: () => Promise<void>): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      'accentTs.format');
    const previous = Object.keys(values)
      .map(
          key => [key, config.inspect(key)
          ?.workspaceValue] as const);
    try {
        for (const [key, value] of Object.entries(values)) {
            await config.update(
              key,
              value,
              vscode.ConfigurationTarget.Workspace);
        }
        await run();
    } finally {
        for (const [key, value] of previous) {
            await config.update(
              key,
              value,
              vscode.ConfigurationTarget.Workspace);
        }
    }
}

describe(
  'Review regressions',
  function() {
      this.timeout(15000);
      it(
        'preserves indentation when formatting a single selected statement',
        async () => {
            for (const insertSpaces of [true, false]) {
                const indent = insertSpaces ? '    ' : '\t';
                const selected = `${indent}const x=1;`;
                const source = `function f() {\n${selected}\n${indent}return x;\n}\n`;
                const formatter = new TsFormatter(
                  {
                      ...getFormatterConfig(),
                      tabSize: 4,
                      insertSpaces
                  });
                const start = source.indexOf(selected);
                const output = await formatter.formatRange(
                  source,
                  start,
                  start + selected.length,
                  'typescript');
                assert.strictEqual(
                  output,
                  source.replace(
                    selected,
                    `${indent}const x = 1;`));
                assert.strictEqual(
                  await formatter.formatRange(
                    output,
                    start,
                    output.indexOf(
                      '\n',
                      start),
                    'typescript'),
                  output);
            }
        });
      it(
        'loads only the selected XML profile and does not borrow other profile settings',
        () => {
            const directory = fs.mkdtempSync(
              path.join(
                os.tmpdir(),
                'formatter-profiles-'));
            const file = path.join(
              directory,
              'profiles.xml');
            try {
                fs.writeFileSync(
                  file,
                  `<profiles>
        <profile name="Two"><setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="2"/>
          <setting id="org.eclipse.jdt.core.formatter.lineSplit" value="80"/></profile>
        <profile name="Eight &amp; Tabs"><setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="8"/>
          <setting id="org.eclipse.jdt.core.formatter.tabulation.char" value="tab"/></profile>
      </profiles>`);
                assert.deepStrictEqual(
                  parseEclipseXmlConfig(
                    file,
                    'Eight & Tabs'),
                  {
                      tabSize: 8,
                      insertSpaces: false
                  });
                assert.deepStrictEqual(
                  parseEclipseXmlConfig(file),
                  {
                      tabSize: 2,
                      maxLineLength: 80
                  });
                assert.deepStrictEqual(
                  parseEclipseXmlConfig(
                    file,
                    'Missing'),
                  {});
            } finally {
                fs.rmSync(
                  directory,
                  {
                      recursive: true,
                      force: true
                  });
            }
        });
      it(
        'runs code actions against their document without changing the active editor',
        async () => {
            await vscode.extensions.getExtension(
              'LemuelAdane.accent-typescript-formatter')!.activate();
            await withSettings(
              {
                  enabled: true,
                  onSave: false,
                  formatOnChange: false,
                  'imports.organizeOnFormat': false
              },
              async () => {
                  const active = await vscode.workspace.openTextDocument(
                    {
                        language: 'typescript',
                        content: 'const active=1;'
                    });
                  const target = await vscode.workspace.openTextDocument(
                    {
                        language: 'typescript',
                        content: 'const target=1;'
                    });
                  await vscode.window.showTextDocument(active);
                  const token = new vscode.CancellationTokenSource();
                  const provider
                    = vscode.languages.registerCodeActionsProvider(
                      'typescript',
                      {
                          provideCodeActions(document) {
                              if (document.uri.toString() !== target.uri.toString()) return [];
                              const action = new vscode.CodeAction(
                                'Test import edit',
                                vscode.CodeActionKind.SourceOrganizeImports);
                              action.edit = new vscode.WorkspaceEdit();
                              action.edit.insert(
                                document.uri,
                                document.positionAt(0),
                                '// organized\n');
                              return [action];
                          }
                      },
                      {
                          providedCodeActionKinds: [vscode.CodeActionKind.SourceOrganizeImports]
                      });
                  try {
                      const actions
                        = new CodeActionProvider().provideCodeActions(
                          target,
                          new vscode.Range(
                            0,
                            0,
                            0,
                            0),
                          {
                              diagnostics: [],
                              triggerKind: vscode.CodeActionTriggerKind.Invoke,
                              only: undefined
                          },
                          token.token);
                      for (const id of ['accentTs.format.document', 'accentTs.format.organizeImports']) {
                          const command = actions.find(
                              action => action.command?.command === id)!.command!;
                          await vscode.commands.executeCommand(
                            command.command,
                            ...command.arguments!);
                          assert.strictEqual(
                            active.getText(),
                            'const active=1;');
                          assert.strictEqual(
                            vscode.window.activeTextEditor?.document,
                            active);
                      }
                      assert.strictEqual(
                        target.getText(),
                        '// organized\nconst target = 1;\n');
                  } finally {
                      provider.dispose();
                      token.dispose();
                  }
              });
        });
      it(
        'rejects selection edits that introduce syntax errors in the enclosing document',
        async () => {
            for (const language of ['typescript', 'javascript']) {
                const source = 'function f() {\n    return (\n        a+b\n    );\n}\n';
                const formatter = new TsFormatter(
                  getFormatterConfig());
                const output = await formatter.formatRange(
                  source,
                  source.indexOf('        a'),
                  source.indexOf('\n    );'),
                  language);
                assert.strictEqual(
                  output,
                  source);
                assert.ok(
                  new AstSyntaxValidator().isSyntacticallyValid(
                    output,
                    language));
            }
        });
      it(
        'honors the legacy import switch unless the alias is explicitly configured',
        async () => {
            await withSettings(
              {
                  organizeImportsOnFormat: false,
                  'imports.organizeOnFormat': undefined
              },
              async () => {
                  assert.strictEqual(
                    getFormatterConfig()
                      .organizeImportsOnFormat,
                    false);
                  await withSettings(
                    {
                        'imports.organizeOnFormat': true
                    },
                    async () => {
                        assert.strictEqual(
                          getFormatterConfig()
                            .organizeImportsOnFormat,
                          true);
                    });
              });
            await withSettings(
              {
                  organizeImportsOnFormat: true,
                  'imports.organizeOnFormat': false
              },
              async () => {
                  assert.strictEqual(
                    getFormatterConfig()
                      .organizeImportsOnFormat,
                    false);
              });
        });
      it(
        'disables providers, commands, code actions, save and change formatting',
        async () => {
            await vscode.extensions.getExtension(
              'LemuelAdane.accent-typescript-formatter')!.activate();
            await withSettings(
              {
                  enabled: false,
                  onSave: true,
                  formatOnChange: true
              },
              async () => {
                  const directory = fs.mkdtempSync(
                    path.join(
                      os.tmpdir(),
                      'formatter-disabled-'));
                  const file = path.join(
                    directory,
                    'sample.ts');
                  const source = 'import { unused } from "missing";\nfunction f(){return 1;}';
                  fs.writeFileSync(
                    file,
                    source);
                  const token = new vscode.CancellationTokenSource();
                  try {
                      const document = await vscode.workspace.openTextDocument(
                        file);
                      const editor = await vscode.window.showTextDocument(
                        document);
                      assert.strictEqual(
                        getFormatterConfig(document)
                          .enabled,
                        false);
                      const provider = new FormattingEditProvider();
                      const range = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(
                          source.length));
                      const options = {
                          tabSize: 4,
                          insertSpaces: true
                      };
                      assert.deepStrictEqual(
                        await provider.provideDocumentFormattingEdits(
                          document,
                          options,
                          token.token),
                        []);
                      assert.deepStrictEqual(
                        await provider.provideDocumentRangeFormattingEdits(
                          document,
                          range,
                          options,
                          token.token),
                        []);
                      assert.deepStrictEqual(
                        new CodeActionProvider().provideCodeActions(
                          document,
                          range,
                          {
                              diagnostics: [],
                              triggerKind: vscode.CodeActionTriggerKind.Invoke,
                              only: undefined
                          },
                          token.token),
                        []);
                      editor.selection = new vscode.Selection(
                        range.start,
                        range.end);
                      for (const command of ['document', 'selection', 'organizeImports']) {
                          await vscode.commands.executeCommand(
                            `accentTs.format.${command}`);
                          assert.strictEqual(
                            document.getText(),
                            source);
                      }
                      await editor.edit(
                          edit => edit.insert(
                          document.positionAt(
                            source.length),
                          '\nconst x=2;'));
                      await new Promise(
                          resolve => setTimeout(
                          resolve,
                          750));
                      const expected = source + '\nconst x=2;';
                      assert.strictEqual(
                        document.getText(),
                        expected);
                      assert.ok(
                        await document.save());
                      assert.strictEqual(
                        fs.readFileSync(
                          file,
                          'utf8'),
                        expected);
                  } finally {
                      token.dispose();
                      fs.rmSync(
                        directory,
                        {
                            recursive: true,
                            force: true
                        });
                  }
              });
        });
      it(
        'documents only registered configuration keys and removes unsupported style settings',
        () => {
            const root = path.resolve(
              __dirname,
              '../../..');
            const manifest = JSON.parse(
              fs.readFileSync(
                path.join(
                  root,
                  'package.json'),
                'utf8'));
            const properties = manifest.contributes.configuration.properties;
            const readme = fs.readFileSync(
              path.join(
                root,
                'README.md'),
              'utf8');
            assert.ok(
              readme.includes('accentTs.format.'));
            for (const match of readme.matchAll(
              /accentTs\.format\.[\w.]+/g)) {
                assert.ok(
                  properties[match[0]],
                  `Unregistered README setting: ${match[0]}`);
            }
            for (const key of ['semi', 'singleQuote', 'trailingComma', 'comments.enabled']) {
                assert.ok(!properties[`accentTs.format.${key}`]);
            }
        });
  });
