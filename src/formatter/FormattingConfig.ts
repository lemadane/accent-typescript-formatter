import * as fs from 'fs';
import * as path from 'path';

let vscodeModule: any;
try {
  vscodeModule = require('vscode');
} catch {
  vscodeModule = undefined;
}

export interface FormatterConfig {
  enabled: boolean;
  tabSize: number;
  continuationIndent: number;
  insertSpaces: boolean;
  maxLineLength: number;
  preset: 'A Standard' | 'Prettier Default' | 'Google-like' | 'Airbnb-like';
  organizeImportsOnFormat: boolean;
  xmlSettingsUrl?: string;
  xmlProfileName?: string;
  onSave: boolean;
  formatOnChange: boolean;
}

export const PRESET_CONFIGS: Record<string, Partial<FormatterConfig>> = {
  'A Standard': {
    tabSize: 4,
    continuationIndent: 2,
    insertSpaces: true,
    maxLineLength: 70,
  },
  'Prettier Default': {
    tabSize: 2,
    insertSpaces: true,
    maxLineLength: 80,
  },
  'Google-like': {
    tabSize: 2,
    insertSpaces: true,
    maxLineLength: 100,
  },
  'Airbnb-like': {
    tabSize: 2,
    insertSpaces: true,
    maxLineLength: 100,
  }
};

export function getFormatterConfig(document?: any): FormatterConfig {
  let vscodeConfig: any;
  try {
    if (vscodeModule
        && vscodeModule.workspace) {
      vscodeConfig = vscodeModule
          .workspace
          .getConfiguration(
              'accentTs.format',
              document?.uri);
    }
  } catch {
    // Fallback for standalone runner environment
  }
  const preset = (vscodeConfig
        ? vscodeConfig.get(
              'preset',
              'A Standard')
        : 'A Standard') as FormatterConfig['preset'];
  const basePreset =
      PRESET_CONFIGS[preset] || PRESET_CONFIGS['A Standard'];
  const organizeImportsSetting = explicitSetting<boolean | undefined>(
      vscodeConfig, 'imports.organizeOnFormat', undefined)
      ?? explicitSetting(vscodeConfig, 'organizeImportsOnFormat', true);
  const config: FormatterConfig = {
    enabled: vscodeConfig?.get('enabled', true) ?? true,
    continuationIndent: explicitSetting(vscodeConfig, 'continuationIndent', basePreset.continuationIndent ?? 4),
    tabSize: explicitSetting(vscodeConfig, 'tabSize', basePreset.tabSize ?? 4),
    insertSpaces: explicitSetting(vscodeConfig, 'insertSpaces', basePreset.insertSpaces ?? true),
    maxLineLength: explicitSetting(vscodeConfig, 'maxLineLength', basePreset.maxLineLength ?? 70),
    preset,
    organizeImportsOnFormat: organizeImportsSetting,
    xmlSettingsUrl: vscodeConfig 
        ? vscodeConfig.get(
            'settings.url',
            '')
        : '',
    xmlProfileName: vscodeConfig 
        ? vscodeConfig.get(
            'settings.profile',
            '')   
        : '',
    onSave: vscodeConfig
        ? vscodeConfig.get(
        'onSave',
        true)
        : true,
    formatOnChange: vscodeConfig 
        ? vscodeConfig.get(
            'formatOnChange',
            false)
        : false
  };
  if (config.xmlSettingsUrl) {
    try {
      const xmlOverrides = parseEclipseXmlConfig(
          config.xmlSettingsUrl,
          config.xmlProfileName,
          document);
      Object.assign(
          config,
          xmlOverrides);
    } catch (err) {
      console.warn(
          `[A TS Formatter] Failed to load XML config from ${config.xmlSettingsUrl}:`,
          err);
    }
  }
  return config;
}

  export function parseEclipseXmlConfig(
      filePathOrUrl: string,
      _profileName?: string,
      document?: any,
  ): Partial<FormatterConfig> {
  let resolvedPath = filePathOrUrl;
  if (document
      && !path.isAbsolute(resolvedPath)
      && vscodeModule
      && vscodeModule.workspace
      && vscodeModule.workspace.getWorkspaceFolder(document.uri)) {
    const rootPath = vscodeModule.workspace.getWorkspaceFolder(
        document.uri)!.uri.fsPath;
    resolvedPath = path.resolve(
        rootPath,
        filePathOrUrl);
  }
  if (!fs.existsSync(resolvedPath)) {
    return {};
  }
  const xmlContent = fs.readFileSync(
      resolvedPath,
      'utf8');
  const overrides: Partial<FormatterConfig> = {};
  const tabSizeMatch = xmlContent.match(
      /id="org.eclipse.jdt.core.formatter.tabulation.size"\s+value="(\d+)"/);
  if (tabSizeMatch) {
    overrides.tabSize = parseInt(
        tabSizeMatch[1],
        10);
  }
  const tabCharMatch = xmlContent.match(
      /id="org.eclipse.jdt.core.formatter.tabulation.char"\s+value="([^"]+)"/);
  if (tabCharMatch) {
    overrides.insertSpaces = tabCharMatch[1] === 'space';
  }
  const lineLengthMatch = xmlContent.match(
      /id="org.eclipse.jdt.core.formatter.lineSplit"\s+value="(\d+)"/);
  if (lineLengthMatch) {
    overrides.maxLineLength = parseInt(
        lineLengthMatch[1],
        10);
  }
  const continuation = xmlContent.match(/id="accent.typescript.formatter.continuationIndent"\s+value="(\d+)"/);
  if (continuation) overrides.continuationIndent = Number(continuation[1]);
  return overrides;
}

export function generateFormatterXmlConfig(): string {
  return `<?xml
      version="1.0" encoding="UTF-8" standalone="no"?>
          <profiles version="12">
              <profile
                  kind="CodeFormatterProfile"
                  name="A Standard TypeScript Profile"
                  version="12">
                <setting
                    id="org.eclipse.jdt.core.formatter.tabulation.char"
                    value="space"/>
                <setting 
                    id="org.eclipse.jdt.core.formatter.tabulation.size"
                    value="4"/>
                <setting
                    id="org.eclipse.jdt.core.formatter.lineSplit"
                    value="70"/>
                <setting
                    id=
                        "org.eclipse.jdt.core.formatter.comment.format_line_comments"
                    value="true"/>
                <setting id="accent.typescript.formatter.continuationIndent" value="2"/>
                </profile>
            </profiles>`;
}


function explicitSetting<T>(config: any, key: string, fallback: T): T {
  const value = config?.inspect(key);
  return value?.workspaceFolderLanguageValue ?? value?.workspaceLanguageValue ?? value?.globalLanguageValue
    ?? value?.workspaceFolderValue ?? value?.workspaceValue ?? value?.globalValue ?? fallback;
}
