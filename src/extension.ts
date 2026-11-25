import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FormattingEditProvider } from './providers/FormattingEditProvider';
import { CodeActionProvider } from './providers/CodeActionProvider';
import { getFormatterConfig, PRESET_CONFIGS, generateFormatterXmlConfig } from './formatter/FormattingConfig';
import { TsFormatter } from './formatter/TsFormatter';

let statusBarItem: vscode.StatusBarItem;

function isTargetLanguage(languageId: string): boolean {
    return (
      languageId === 'typescript' ||
        languageId === 'typescriptreact' ||
        languageId === 'javascript' ||
        languageId === 'javascriptreact'
  );
}

function getEditorSelector(): vscode.DocumentSelector {
    return [
    {
        language: 'typescript'
    },
    {
        language: 'typescriptreact'
    },
    {
        language: 'javascript'
    },
    {
        language: 'javascriptreact'
    }
  ];
}

export function activate(context: vscode.ExtensionContext) {
    console.log(
      '[Accent Typescript Formatter] Extension activated successfully.');
    const selector = getEditorSelector();
    const formattingProvider = new FormattingEditProvider();
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider(
        selector,
        formattingProvider));
    context.subscriptions.push(
      vscode.languages.registerDocumentRangeFormattingEditProvider(
        selector,
        formattingProvider));
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        selector,
        new CodeActionProvider(),
        {
            providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds
        }));
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100);
    statusBarItem.command = 'accentTs.format.selectProfile';
    context.subscriptions.push(statusBarItem);
    updateStatusBarItem(vscode.window.activeTextEditor);
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(
          editor => updateStatusBarItem(editor)));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.document',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor
              || !isTargetLanguage(editor.document.languageId)) {
                vscode.window.showWarningMessage(
                  'Accent Typescript Formatter: Please open a TypeScript file to format.');
                return;
            }
            const cfg = getFormatterConfig(editor.document);
            if (!cfg.enabled) return;
            if (cfg.organizeImportsOnFormat) {
                try {
                    await vscode.commands.executeCommand(
                      'editor.action.organizeImports');
                } catch {
                // Ignore if organizeImports is unavailable
                }
            }
            const edits =
              await formattingProvider.provideDocumentFormattingEdits(
                editor.document,
                {
                    tabSize: editor.options.tabSize as number,
                    insertSpaces: editor.options.insertSpaces as boolean
                },
                new vscode.CancellationTokenSource().token);
            if (edits
              && edits.length > 0) {
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.set(
                  editor.document.uri,
                  edits);
                await vscode.workspace.applyEdit(workspaceEdit);
            }
            vscode.window.showInformationMessage(
              'Accent Typescript Formatter: Document formatted cleanly.');
        }));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.selection',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor
              || !isTargetLanguage(editor.document.languageId)
              || editor.selection.isEmpty) {
                vscode.window.showWarningMessage(
                  'Accent Typescript Formatter: Please select TypeScript code to format.');
                return;
            }
            const edits =
              await formattingProvider.provideDocumentRangeFormattingEdits(
                editor.document,
                editor.selection,
                {
                    tabSize: editor.options.tabSize as number,
                    insertSpaces: editor.options.insertSpaces as boolean
                },
                new vscode.CancellationTokenSource().token);
            if (edits
              && edits.length > 0) {
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.set(
                  editor.document.uri,
                  edits);
                await vscode.workspace.applyEdit(workspaceEdit);
            }
        }));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.organizeImports',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor
              || !isTargetLanguage(editor.document.languageId)) {
                vscode.window.showWarningMessage(
                  'Accent Typescript Formatter: Please open a TypeScript file to organize imports.');
                return;
            }
            if (!getFormatterConfig(editor.document).enabled) return;
            await vscode.commands.executeCommand(
              'editor.action.organizeImports');
            vscode.window.showInformationMessage(
              'Accent Typescript Formatter: Imports organized.');
        }));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.selectProfile',
        async () => {
            const profiles = Object.keys(PRESET_CONFIGS);
            const selected = await vscode.window.showQuickPick(
              profiles,
              {
                  placeHolder: 'Select Accent Typescript Formatter Profile'
              });
            if (selected) {
                const config = vscode.workspace.getConfiguration(
                  'accentTs.format');
                await config.update(
                  'preset',
                  selected,
                  vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                  `Accent Typescript Formatter: Switched style profile to "${selected}".`);
                updateStatusBarItem(vscode.window.activeTextEditor);
            }
        }));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.exportConfig',
        async () => {
            const workspaceFolders =
              vscode.workspace.workspaceFolders;
            if (!workspaceFolders
              || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage(
                  'Accent Typescript Formatter: Please open a workspace folder to export XML configuration.');
                return;
            }
            const vscodeDir = path.join(
              workspaceFolders[0].uri.fsPath,
              '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(
                  vscodeDir,
                  {
                      recursive: true
                  });
            }
            const xmlPath = path.join(
              vscodeDir,
              'accent-typescript-formatter.xml');
            fs.writeFileSync(
              xmlPath,
              generateFormatterXmlConfig(),
              'utf8');
            const config = vscode.workspace.getConfiguration(
              'accentTs.format');
            await config.update(
              'settings.url',
              '.vscode/accent-typescript-formatter.xml',
              vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(
              `Accent Typescript Formatter: Exported XML configuration profile to "${xmlPath}".`);
        }));
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'accentTs.format.setAsDefault',
        async () => {
            const extensionId =
              'lemueladane.accent-typescript-formatter';
            await vscode.workspace
            .getConfiguration('[typescript]')
              .update(
                'editor.defaultFormatter',
                extensionId,
                vscode.ConfigurationTarget.Global);
            await vscode.workspace
            .getConfiguration('[typescriptreact]')
              .update(
                'editor.defaultFormatter',
                extensionId,
                vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(
              'Accent Typescript Formatter is now set as the default formatter for TypeScript in VS Code.');
        }));
    context.subscriptions.push(
      vscode.workspace.onWillSaveTextDocument(
          event => {
            if (!isTargetLanguage(event.document.languageId)) {
                return;
            }
            const config = getFormatterConfig(event.document);
            if (!config.enabled || !config.onSave) {
                return;
            }
            const formatter = new TsFormatter(config);
            const original = event.document.getText();
            event.waitUntil(
              (async () => {
                  const formatted = await formatter.formatDocument(
                    original,
                    event.document.languageId);
                  if (formatted === original) {
                      return [];
                  }
                  const range = new vscode.Range(
                    event.document.positionAt(0),
                    event.document.positionAt(
                      original.length));
                  return [vscode.TextEdit.replace(
                    range,
                    formatted)];
              })());
        }));
    let changeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    let isSelfFormatting = false;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(
        async event => {
            if (isSelfFormatting
              || !isTargetLanguage(event.document.languageId)) {
                return;
            }
            if (event.contentChanges.length === 0) {
                return;
            }
            const config = getFormatterConfig(event.document);
            if (!config.enabled || !config.formatOnChange) {
                return;
            }
            if (changeDebounceTimer) {
                clearTimeout(changeDebounceTimer);
            }
            changeDebounceTimer = setTimeout(
              async () => {
                  const editor = vscode.window.activeTextEditor;
                  if (!editor
                    || editor.document !== event.document) {
                      return;
                  }
                  const currentConfig = getFormatterConfig(event.document);
                  if (!currentConfig.enabled || !currentConfig.formatOnChange) return;
                  const formatter = new TsFormatter(currentConfig);
                  const original = event.document.getText();
                  const formatted = await formatter.formatDocument(
                    original,
                    event.document.languageId);
                  if (original !== formatted) {
                      isSelfFormatting = true;
                      try {
                          const fullRange = new vscode.Range(
                            event.document.positionAt(
                              0),
                            event.document.positionAt(
                              original.length));
                          const workspaceEdit =
                            new vscode.WorkspaceEdit();
                          workspaceEdit.replace(
                            event.document.uri,
                            fullRange,
                            formatted);
                          await vscode.workspace.applyEdit(
                            workspaceEdit);
                      } finally {
                          isSelfFormatting = false;
                      }
                  }
              },
              500);
        }));
}

function updateStatusBarItem(
  editor: vscode.TextEditor | undefined): void {
    if (editor
      && isTargetLanguage(editor.document.languageId)) {
        const config = getFormatterConfig(editor.document);
        statusBarItem.text = `$(code) Accent TS: ${config.preset}`;
        statusBarItem.tooltip =
          'Click to switch Accent Typescript Formatter style profile';
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

export function deactivate() { }
