# Accent Typescript Formatter (VS Code)

Formats TypeScript, JavaScript, TSX, and JSX using the layout of the Accent Java Formatter v0.9.10, adapted to JavaScript and TypeScript syntax.

## Latest fixes

- Formatting and import code actions target the requested document even when another editor is active.
- Formatting a single selected statement preserves its spaces or tabs without adding a whitespace-only line.
- XML settings are read only from the selected profile, without borrowing settings from other profiles.

These fixes are included in the rebuilt `0.1.0` VSIX; the package version is unchanged.

## Version 0.2.1

Carries over the Java formatter v0.9.9–v0.9.10 updates: generic `extends` bounds remain together while inheritance clauses wrap, and assignment call headers include indentation when measured against the wrapping target. Headers that fit stay with the assignment; longer headers move `= call(` to a continuation line, with arguments one continuation level deeper. Existing breaks around `=` are normalized for wrapped calls. Custom indentation and tabs are supported.

## Version 0.2.0

The A Standard preset now uses **four-space blocks**, **independent two-space continuations**, and a **70-column wrapping target**. Formatting on save is enabled by default. Existing explicit settings continue to override the preset.

```typescript
class Sample {
    run() {
        users.query()
          .where(
            'active',
            '=',
            false)
          .limit(10);
        send(
          first,
          convert(
            second,
            third));
    }
}
```

## Formatting behavior

- Multiple call arguments and declaration parameters go on separate lines, including nested and already wrapped calls.
- Nested calls receive their own continuation step. Simple trailing calls such as `.limit(10)` stay compact.
- Closing parentheses follow the final argument or parameter. A trailing line comment keeps the closing parenthesis on a separate line. Existing trailing commas are preserved.
- Nonempty executable blocks expand, and members and statements use the configured block width.
- Decorators and `extends` / `implements` clauses use dedicated lines.
- Wrapped assignments, logical expressions, and ternary branches use continuation indentation independent of block width. With tabs, remaining continuation columns use spaces.
- Strings, regex literals, template text, JSX text, and comment contents are protected. Formatting edits are checked for syntax-tree preservation and repeat-format stability.
- Selection formatting changes only the selected lines. Selections crossing literal or comment boundaries are left unchanged.

The line length is a wrapping target. Long indivisible strings, identifiers, and protected comments can exceed it. These are TypeScript adaptations of the Java layout rules, not byte-for-byte cross-language parity. Existing quote and trailing-comma spelling is preserved. Semicolons follow the TypeScript formatting pipeline. The previously exposed `semi`, `singleQuote`, `trailingComma`, and `comments.enabled` options were unsupported and have been removed; existing entries for those options can be deleted. Comment contents are preserved.

## Configuration

Settings and command IDs now use the `accentTs.format` prefix. Update existing custom settings and keyboard shortcuts to this prefix; previous names are no longer recognized.

```json
{
  "accentTs.format.enabled": true,
  "accentTs.format.preset": "A Standard",
  "accentTs.format.tabSize": 4,
  "accentTs.format.continuationIndent": 2,
  "accentTs.format.insertSpaces": true,
  "accentTs.format.maxLineLength": 70,
  "accentTs.format.imports.organizeOnFormat": true,
  "accentTs.format.onSave": true,
  "accentTs.format.formatOnChange": false
}
```

To retain the previous indentation widths, explicitly set `tabSize` to `2`, `continuationIndent` to `4`, and `maxLineLength` to `80`. Other presets retain their own block widths and wrapping targets.

Local Eclipse-style XML settings can be loaded with `accentTs.format.settings.url`. The exported profile includes the new block width, line length, and `accent.typescript.formatter.continuationIndent` setting (measured in columns).

Set `accentTs.format.settings.profile` to the profile name to select it from an XML file. When no name is configured, the first profile is used. A name that does not match any profile applies no XML overrides.

The `enabled` switch disables formatting and import actions, including automatic save/change formatting. When explicitly set, `imports.organizeOnFormat` takes precedence over the legacy `organizeImportsOnFormat` setting; otherwise the legacy setting is honored.

## Commands

Search for **Accent Typescript Formatter** in the Command Palette to format the document or selection, organize imports, select a profile, export XML settings, or set the default formatter.

**Format Document:** `Ctrl+Alt+L` on Windows/Linux or `Cmd+Option+L` on macOS.

The VS Code extension-host suite covers Java-style structural layout, custom indentation and tabs, literal preservation, syntax safety, repeated formatting, selection boundaries, and editor commands. Regression coverage also includes 69/70/71-column assignment headers, existing assignment breaks, generic bounds, constructors, custom continuation widths, tabs, and comments around assignments.

The latest validation passed all 93 tests, including regressions for document targeting, single-line selection indentation, and XML profile isolation.

Install the packaged extension from VS Code's **Extensions → … → Install from VSIX…**, selecting `accent-typescript-formatter-0.1.0.vsix`.
