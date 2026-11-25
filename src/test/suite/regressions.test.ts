import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TsFormatter } from '../../formatter/TsFormatter';
import { getFormatterConfig } from '../../formatter/FormattingConfig';
import { AstSyntaxValidator } from '../../formatter/AstSyntaxValidator';
import { FormattingEditProvider } from '../../providers/FormattingEditProvider';
import { CodeActionProvider } from '../../providers/CodeActionProvider';

async function withSettings(values: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
  const config = vscode.workspace.getConfiguration('accentTs.format');
  const previous = Object.keys(values).map(key => [key, config.inspect(key)?.workspaceValue] as const);
  try {
    for (const [key, value] of Object.entries(values)) {
      await config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }
    await run();
  } finally {
    for (const [key, value] of previous) {
      await config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }
  }
}

describe('Review regressions', function () {
  this.timeout(15000);

  it('rejects selection edits that introduce syntax errors in the enclosing document', async () => {
    for (const language of ['typescript', 'javascript']) {
      const source = 'function f() {\n    return (\n        a+b\n    );\n}\n';
      const formatter = new TsFormatter(getFormatterConfig());
      const output = await formatter.formatRange(
        source, source.indexOf('        a'), source.indexOf('\n    );'), language);
      assert.strictEqual(output, source);
      assert.ok(new AstSyntaxValidator().isSyntacticallyValid(output, language));
    }
  });

  it('honors the legacy import switch unless the alias is explicitly configured', async () => {
    await withSettings({ organizeImportsOnFormat: false, 'imports.organizeOnFormat': undefined }, async () => {
      assert.strictEqual(getFormatterConfig().organizeImportsOnFormat, false);
      await withSettings({ 'imports.organizeOnFormat': true }, async () => {
        assert.strictEqual(getFormatterConfig().organizeImportsOnFormat, true);
      });
    });
    await withSettings({ organizeImportsOnFormat: true, 'imports.organizeOnFormat': false }, async () => {
      assert.strictEqual(getFormatterConfig().organizeImportsOnFormat, false);
    });
  });

  it('disables providers, commands, code actions, save and change formatting', async () => {
    await vscode.extensions.getExtension('LemuelAdane.accent-typescript-formatter')!.activate();
    await withSettings({ enabled: false, onSave: true, formatOnChange: true }, async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'formatter-disabled-'));
      const file = path.join(directory, 'sample.ts');
      const source = 'import { unused } from "missing";\nfunction f(){return 1;}';
      fs.writeFileSync(file, source);
      const token = new vscode.CancellationTokenSource();
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(document);
        assert.strictEqual(getFormatterConfig(document).enabled, false);
        const provider = new FormattingEditProvider();
        const range = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
        const options = { tabSize: 4, insertSpaces: true };
        assert.deepStrictEqual(await provider.provideDocumentFormattingEdits(document, options, token.token), []);
        assert.deepStrictEqual(await provider.provideDocumentRangeFormattingEdits(document, range, options, token.token), []);
        assert.deepStrictEqual(new CodeActionProvider().provideCodeActions(document, range,
          { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }, token.token), []);
        editor.selection = new vscode.Selection(range.start, range.end);
        for (const command of ['document', 'selection', 'organizeImports']) {
          await vscode.commands.executeCommand(`accentTs.format.${command}`);
          assert.strictEqual(document.getText(), source);
        }
        await editor.edit(edit => edit.insert(document.positionAt(source.length), '\nconst x=2;'));
        await new Promise(resolve => setTimeout(resolve, 750));
        const expected = source + '\nconst x=2;';
        assert.strictEqual(document.getText(), expected);
        assert.ok(await document.save());
        assert.strictEqual(fs.readFileSync(file, 'utf8'), expected);
      } finally {
        token.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  it('documents only registered configuration keys and removes unsupported style settings', () => {
    const root = path.resolve(__dirname, '../../..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const properties = manifest.contributes.configuration.properties;
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.ok(readme.includes('accentTs.format.'));
    for (const match of readme.matchAll(/accentTs\.format\.[\w.]+/g)) {
      assert.ok(properties[match[0]], `Unregistered README setting: ${match[0]}`);
    }
    for (const key of ['semi', 'singleQuote', 'trailingComma', 'comments.enabled']) {
      assert.ok(!properties[`accentTs.format.${key}`]);
    }
  });
});
