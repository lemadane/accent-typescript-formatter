import * as vscode from 'vscode';
import { getFormatterConfig } from '../formatter/FormattingConfig';

export class CodeActionProvider
  implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.SourceOrganizeImports,
    vscode.CodeActionKind.SourceFixAll
  ];
    public provideCodeActions(
      document: vscode.TextDocument,
      _range: vscode.Range | vscode.Selection,
      _context: vscode.CodeActionContext,
      _token: vscode.CancellationToken): Array<vscode.CodeAction> {
        if (!getFormatterConfig(document).enabled) return [];
        const actions: vscode.CodeAction[] = [];
        const organizeImportsAction = new vscode.CodeAction(
          'Organize TS Imports (A)',
          vscode.CodeActionKind.SourceOrganizeImports);
        organizeImportsAction.command = {
            command: 'accentTs.format.organizeImports',
            title: 'Organize Imports',
            arguments: [document.uri]
        };
        actions.push(organizeImportsAction);
        const formatDocumentAction = new vscode.CodeAction(
          'Format TS Document (A)',
          vscode.CodeActionKind.SourceFixAll);
        formatDocumentAction.command = {
            command: 'accentTs.format.document',
            title: 'Format Document',
            arguments: [document.uri]
        };
        actions.push(formatDocumentAction);
        return actions;
    }
}
