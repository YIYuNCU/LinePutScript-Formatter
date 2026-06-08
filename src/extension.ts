import * as vscode from "vscode";
import { formatLpsDocument } from "./formatter";
import {
  collectNamesFromLines,
  formatLineRange,
  getCompletionItems,
  getDiagnosticsForLines,
  getDocumentSymbols,
  getHoverForPosition,
  getSymbolsForLines,
  LineReader,
  LpsDiagnostic,
  LpsSymbol,
  parseLineAt,
  parseWindow,
  TextPosition,
  TextRange,
  VisibleRange,
} from "./languageService";

const configurationSection = "lineputscript";
const lpsLanguage = "lps";
const defaultMaxFormatDocumentSize = 1024 * 1024;
const defaultMaxLanguageServiceDocumentSize = 1024 * 1024;
const defaultDiagnosticVisibleBufferLines = 50;
const defaultBackgroundIndexTimeBudgetMs = 8;
const defaultMaxDocumentSymbolsForLargeFile = 2000;
const localCompletionRadius = 50;

interface FormatterSettings {
  enabled: boolean;
  maxFormatDocumentSize: number;
}

interface LanguageServiceSettings {
  enabled: boolean;
  lazyLanguageService: boolean;
  maxLanguageServiceDocumentSize: number;
  diagnosticVisibleBufferLines: number;
  backgroundIndexTimeBudgetMs: number;
  maxDocumentSymbolsForLargeFile: number;
}

interface DocumentNameIndex {
  names: Set<string>;
  nextLine: number;
  version: number;
  timer?: NodeJS.Timeout;
}

class VsCodeLineReader implements LineReader {
  constructor(private readonly document: vscode.TextDocument) {}

  get lineCount(): number {
    return this.document.lineCount;
  }

  lineAt(lineNumber: number): string {
    return this.document.lineAt(lineNumber).text;
  }
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection("lineputscript");
const nameIndexes = new Map<string, DocumentNameIndex>();
const diagnosticTimers = new Map<string, NodeJS.Timeout>();

function atLeast(value: number, minimum: number): number {
  return Math.max(minimum, value);
}

function getFormatterSettings(): FormatterSettings {
  const configuration = vscode.workspace.getConfiguration(configurationSection);

  return {
    enabled: configuration.get<boolean>("formatterSwitch", false),
    maxFormatDocumentSize: atLeast(
      configuration.get<number>("maxFormatDocumentSize", defaultMaxFormatDocumentSize),
      0
    ),
  };
}

function getLanguageServiceSettings(): LanguageServiceSettings {
  const configuration = vscode.workspace.getConfiguration(configurationSection);

  return {
    enabled: configuration.get<boolean>("languageServiceSwitch", true),
    lazyLanguageService: configuration.get<boolean>("lazyLanguageService", true),
    maxLanguageServiceDocumentSize: atLeast(
      configuration.get<number>(
        "maxLanguageServiceDocumentSize",
        defaultMaxLanguageServiceDocumentSize
      ),
      0
    ),
    diagnosticVisibleBufferLines: atLeast(
      configuration.get<number>(
        "diagnosticVisibleBufferLines",
        defaultDiagnosticVisibleBufferLines
      ),
      0
    ),
    backgroundIndexTimeBudgetMs: atLeast(
      configuration.get<number>(
        "backgroundIndexTimeBudgetMs",
        defaultBackgroundIndexTimeBudgetMs
      ),
      1
    ),
    maxDocumentSymbolsForLargeFile: atLeast(
      configuration.get<number>(
        "maxDocumentSymbolsForLargeFile",
        defaultMaxDocumentSymbolsForLargeFile
      ),
      0
    ),
  };
}

function getFullDocumentRange(document: vscode.TextDocument): vscode.Range {
  if (document.lineCount === 0) {
    return new vscode.Range(0, 0, 0, 0);
  }

  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length);
}

function getDocumentLength(document: vscode.TextDocument): number {
  if (document.lineCount === 0) {
    return 0;
  }

  const lastLine = document.lineAt(document.lineCount - 1);
  return document.offsetAt(lastLine.range.end);
}

function toVsCodeRange(range: TextRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function toTextPosition(position: vscode.Position): TextPosition {
  return {
    line: position.line,
    character: position.character,
  };
}

function toVisibleRanges(editor: vscode.TextEditor): VisibleRange[] {
  return editor.visibleRanges.map((range) => ({
    startLine: range.start.line,
    endLine: range.end.line,
  }));
}

function getVisibleRangesForDocument(document: vscode.TextDocument): VisibleRange[] {
  const editor = vscode.window.visibleTextEditors.find(
    (visibleEditor) => visibleEditor.document.uri.toString() === document.uri.toString()
  );

  if (!editor) {
    return [];
  }

  return toVisibleRanges(editor);
}

function toDiagnostic(diagnostic: LpsDiagnostic): vscode.Diagnostic {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;

  return new vscode.Diagnostic(toVsCodeRange(diagnostic.range), diagnostic.message, severity);
}

function toCompletionKind(kind: ReturnType<typeof getCompletionItems>[number]["kind"]): vscode.CompletionItemKind {
  switch (kind) {
    case "field":
      return vscode.CompletionItemKind.Field;
    case "property":
      return vscode.CompletionItemKind.Property;
    case "operator":
      return vscode.CompletionItemKind.Operator;
    case "snippet":
      return vscode.CompletionItemKind.Snippet;
    case "constant":
      return vscode.CompletionItemKind.Constant;
  }
}

function toDocumentSymbol(symbol: LpsSymbol): vscode.DocumentSymbol {
  const range = toVsCodeRange(symbol.range);
  const documentSymbol = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail,
    vscode.SymbolKind.Property,
    range,
    range
  );
  documentSymbol.children = symbol.children.map(toDocumentSymbol);
  return documentSymbol;
}

function isLpsDocument(document: vscode.TextDocument): boolean {
  return document.languageId === lpsLanguage;
}

async function formatDocument(
  document: vscode.TextDocument,
  showMessages: boolean
): Promise<vscode.TextEdit[]> {
  const settings = getFormatterSettings();

  if (!settings.enabled) {
    if (showMessages) {
      await vscode.window.showInformationMessage(
        "LinePutScript formatting is disabled. Enable lineputscript.formatterSwitch to format LPS files."
      );
    }

    return [];
  }

  const documentLength = getDocumentLength(document);
  if (documentLength > settings.maxFormatDocumentSize) {
    if (showMessages) {
      await vscode.window.showWarningMessage(
        `LinePutScript formatting skipped: document has ${documentLength} characters, above lineputscript.maxFormatDocumentSize (${settings.maxFormatDocumentSize}).`
      );
    }

    return [];
  }

  const text = document.getText();
  const formattedText = formatLpsDocument(text);
  if (formattedText === text) {
    return [];
  }

  return [vscode.TextEdit.replace(getFullDocumentRange(document), formattedText)];
}

function formatRange(
  document: vscode.TextDocument,
  range: vscode.Range
): vscode.TextEdit[] {
  if (!getFormatterSettings().enabled) {
    return [];
  }

  const reader = new VsCodeLineReader(document);
  const formattedText = formatLineRange(reader, range.start.line, range.end.line);
  const targetRange = new vscode.Range(
    range.start.line,
    0,
    range.end.line,
    document.lineAt(range.end.line).text.length
  );
  const originalText = document.getText(targetRange);

  if (formattedText === originalText) {
    return [];
  }

  return [vscode.TextEdit.replace(targetRange, formattedText)];
}

function scheduleDiagnostics(document: vscode.TextDocument, delayMs = 300) {
  if (!isLpsDocument(document)) {
    return;
  }

  const key = document.uri.toString();
  const oldTimer = diagnosticTimers.get(key);
  if (oldTimer) {
    clearTimeout(oldTimer);
  }

  diagnosticTimers.set(
    key,
    setTimeout(() => {
      diagnosticTimers.delete(key);
      refreshDiagnostics(document);
    }, delayMs)
  );
}

function refreshDiagnostics(document: vscode.TextDocument) {
  const settings = getLanguageServiceSettings();
  if (!settings.enabled) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const reader = new VsCodeLineReader(document);
  const visibleRanges = settings.lazyLanguageService
    ? getVisibleRangesForDocument(document)
    : [{ startLine: 0, endLine: document.lineCount - 1 }];
  const parsedLines = parseWindow(
    reader,
    visibleRanges,
    settings.lazyLanguageService ? settings.diagnosticVisibleBufferLines : 0
  );
  diagnosticCollection.set(document.uri, getDiagnosticsForLines(parsedLines).map(toDiagnostic));
  updateNameIndexFromParsedLines(document, parsedLines);
}

function getNameIndex(document: vscode.TextDocument): DocumentNameIndex {
  const key = document.uri.toString();
  const existing = nameIndexes.get(key);
  if (existing && existing.version === document.version) {
    return existing;
  }

  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const nextIndex: DocumentNameIndex = {
    names: new Set<string>(),
    nextLine: 0,
    version: document.version,
  };
  nameIndexes.set(key, nextIndex);
  return nextIndex;
}

function updateNameIndexFromParsedLines(
  document: vscode.TextDocument,
  parsedLines: ReturnType<typeof parseWindow>
) {
  const index = getNameIndex(document);
  for (const name of collectNamesFromLines(parsedLines)) {
    index.names.add(name);
  }
}

function scheduleBackgroundIndex(document: vscode.TextDocument) {
  if (!isLpsDocument(document)) {
    return;
  }

  const settings = getLanguageServiceSettings();
  if (!settings.enabled) {
    return;
  }

  const index = getNameIndex(document);
  if (index.timer || index.nextLine >= document.lineCount) {
    return;
  }

  index.timer = setTimeout(() => {
    index.timer = undefined;
    runBackgroundIndexChunk(document);
  }, 0);
}

function runBackgroundIndexChunk(document: vscode.TextDocument) {
  const settings = getLanguageServiceSettings();
  const index = getNameIndex(document);
  const reader = new VsCodeLineReader(document);
  const startTime = Date.now();

  while (
    index.nextLine < document.lineCount &&
    Date.now() - startTime < settings.backgroundIndexTimeBudgetMs
  ) {
    const parsedLine = parseLineAt(reader, index.nextLine);
    updateNameIndexFromParsedLines(document, [parsedLine]);
    index.nextLine++;
  }

  if (index.nextLine < document.lineCount) {
    scheduleBackgroundIndex(document);
  }
}

function registerLanguageService(context: vscode.ExtensionContext) {
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(lpsLanguage, {
      provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.Hover> {
        if (token.isCancellationRequested || !getLanguageServiceSettings().enabled) {
          return undefined;
        }

        const hover = getHoverForPosition(
          new VsCodeLineReader(document),
          toTextPosition(position)
        );
        if (!hover) {
          return undefined;
        }

        return new vscode.Hover(
          hover.contents.map((content) => new vscode.MarkdownString(content)),
          toVsCodeRange(hover.range)
        );
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(lpsLanguage, {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.CompletionItem[]> {
        if (token.isCancellationRequested || !getLanguageServiceSettings().enabled) {
          return [];
        }

        scheduleBackgroundIndex(document);
        const items = getCompletionItems(
          new VsCodeLineReader(document),
          toTextPosition(position),
          getNameIndex(document).names,
          localCompletionRadius
        );

        return items.map((item) => {
          const completion = new vscode.CompletionItem(
            item.label,
            toCompletionKind(item.kind)
          );
          completion.detail = item.detail;
          completion.insertText = item.insertText;
          return completion;
        });
      },
    }, ":", "#", "/", "|")
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(lpsLanguage, {
      provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        if (token.isCancellationRequested || !getLanguageServiceSettings().enabled) {
          return [];
        }

        const settings = getLanguageServiceSettings();
        const reader = new VsCodeLineReader(document);
        const documentLength = getDocumentLength(document);
        const symbols = documentLength > settings.maxLanguageServiceDocumentSize
          ? getSymbolsForLines(
            parseWindow(
              reader,
              getVisibleRangesForDocument(document),
              settings.diagnosticVisibleBufferLines
            ),
            settings.maxDocumentSymbolsForLargeFile
          )
          : getDocumentSymbols(reader, settings.maxDocumentSymbolsForLargeFile);

        return symbols.map(toDocumentSymbol);
      },
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        scheduleDiagnostics(editor.document, 100);
        scheduleBackgroundIndex(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      scheduleDiagnostics(event.textEditor.document, 150);
      scheduleBackgroundIndex(event.textEditor.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isLpsDocument(event.document)) {
        return;
      }

      const index = nameIndexes.get(event.document.uri.toString());
      if (index?.timer) {
        clearTimeout(index.timer);
      }
      nameIndexes.delete(event.document.uri.toString());
      scheduleDiagnostics(event.document);
      scheduleBackgroundIndex(event.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
      const key = document.uri.toString();
      const index = nameIndexes.get(key);
      if (index?.timer) {
        clearTimeout(index.timer);
      }
      nameIndexes.delete(key);
      const diagnosticTimer = diagnosticTimers.get(key);
      if (diagnosticTimer) {
        clearTimeout(diagnosticTimer);
      }
      diagnosticTimers.delete(key);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(configurationSection)) {
        return;
      }

      diagnosticCollection.clear();
      nameIndexes.clear();
      for (const editor of vscode.window.visibleTextEditors) {
        scheduleDiagnostics(editor.document, 100);
        scheduleBackgroundIndex(editor.document);
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(lpsLanguage, {
      provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken
      ): Thenable<vscode.TextEdit[]> {
        if (token.isCancellationRequested) {
          return Promise.resolve([]);
        }

        return formatDocument(document, false);
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(lpsLanguage, {
      provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.TextEdit[]> {
        if (token.isCancellationRequested) {
          return [];
        }

        return formatRange(document, range);
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lineputscript.format", async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) {
        return;
      }

      const edits = await formatDocument(document, true);
      if (edits.length === 0) {
        return;
      }

      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(document.uri, edits);
      await vscode.workspace.applyEdit(workspaceEdit);
    })
  );

  registerLanguageService(context);

  for (const editor of vscode.window.visibleTextEditors) {
    scheduleDiagnostics(editor.document, 100);
    scheduleBackgroundIndex(editor.document);
  }
}

export function deactivate() {}
