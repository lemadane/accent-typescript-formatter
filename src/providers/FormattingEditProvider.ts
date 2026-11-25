import * as vscode from 'vscode';
import { getFormatterConfig } from '../formatter/FormattingConfig';
import { TsFormatter } from '../formatter/TsFormatter';

export class FormattingEditProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
  public async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const config = getFormatterConfig(document);
        const userTabSizeSetting = vscode.workspace.getConfiguration(
        'accentTs.format',
        document.uri).get<number>('tabSize'
    );

    if (userTabSizeSetting === undefined
        && options.tabSize) {
      config.tabSize = options.tabSize;
    }

    const formatter = new TsFormatter(config);
    const originalText = document.getText();
        const formattedText = await formatter.formatDocument(
        originalText,
        document.languageId
    );

    if (originalText === formattedText) {
      return [];
    }

        const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
    );
        return [vscode.TextEdit.replace(
        fullRange,
        formattedText
    )];
  }

  public async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const config = getFormatterConfig(document);
    const userTabSizeSetting = vscode.workspace.getConfiguration(
      'accentTs.format',
      document.uri
    ).get<number>('tabSize');

    if (userTabSizeSetting === undefined && options.tabSize) {
      config.tabSize = options.tabSize;
    }

    const formatter = new TsFormatter(config);

    const lineRange = new vscode.Range(
      new vscode.Position(range.start.line, 0),
      document.lineAt(range.end.line).range.end
    );

    const originalRangeText = document.getText(lineRange);
    const fullText = document.getText();
    const startOffset = document.offsetAt(lineRange.start);
    const endOffset = document.offsetAt(lineRange.end);
    const formattedDocument = await formatter.formatRange(fullText, startOffset, endOffset, document.languageId);
    const formattedRangeText = formattedDocument.slice(startOffset, formattedDocument.length - (fullText.length - endOffset));

    if (originalRangeText === formattedRangeText) {
      return [];
    }

    return [vscode.TextEdit.replace(lineRange, formattedRangeText)];
  }
}
