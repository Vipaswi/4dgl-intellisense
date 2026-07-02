/**
 * DocumentManager keeps a per-file parse cache and resolves include chains.
 *
 * Include resolution order for each #inherit / #INCLUDE / #USE path:
 *   1. Relative to the including file's directory (fast, covers explicit paths)
 *   2. Workspace-wide index lookup by filename — built once with
 *      vscode.workspace.findFiles and kept live by a FileSystemWatcher.
 *      When a bare name like "utils.inc" matches multiple files, the one
 *      whose path shares the most directory components with the including
 *      file wins ("closest match" heuristic).
 *
 * getSymbolsForDocument(uri) returns symbols visible from that file only:
 * its own symbols PLUS every transitively included file's symbols.
 * Sibling files not reachable through the include chain are invisible.
 *
 * Circular include chains are handled via a visited-path guard.
 */

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { parseDocument } = require("./documentParser");

const GLOB_PATTERN = "**/*.{4dg,4dgl,lib,inc}";
const EMPTY = Object.freeze({ functions: {}, variables: {}, constants: {}, includes: [] });

class DocumentManager {
  constructor() {
    // lowercased filePath → parsed result
    this._cache = new Map();
    // lowercased basename → Set of absolute file paths (workspace index)
    this._index = new Map();
  }

  // ── Activation ────────────────────────────────────────────────────────────

  activate(context) {
    // Track open-document edits to keep the parse cache hot
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "4dgl") {
          this._updateFromDocument(e.document);
        }
      })
    );
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "4dgl") {
          this._updateFromDocument(doc);
        }
      })
    );
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId === "4dgl") {
          this._updateFromDocument(doc);
        }
      })
    );

    // Parse already-open 4DGL documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "4dgl") {
        this._updateFromDocument(doc);
      }
    }

    // Build the workspace file index asynchronously (does not block activation)
    this._buildIndex();

    // Keep the index live as files are created or deleted
    const watcher = vscode.workspace.createFileSystemWatcher(GLOB_PATTERN);
    watcher.onDidCreate((uri) => this._indexAdd(uri.fsPath));
    watcher.onDidDelete((uri) => this._indexRemove(uri.fsPath));
    // On rename/save, invalidate the stale parse cache entry
    watcher.onDidChange((uri) => {
      this._cache.delete(this._key(uri.fsPath));
    });
    context.subscriptions.push(watcher);
  }

  // ── Workspace index ───────────────────────────────────────────────────────

  async _buildIndex() {
    try {
      const uris = await vscode.workspace.findFiles(GLOB_PATTERN);
      for (const uri of uris) {
        this._indexAdd(uri.fsPath);
      }
    } catch {
      // Non-fatal: direct relative resolution still works without the index
    }
  }

  _indexAdd(filePath) {
    const key = path.basename(filePath).toLowerCase();
    if (!this._index.has(key)) this._index.set(key, new Set());
    this._index.get(key).add(filePath);
  }

  _indexRemove(filePath) {
    const key = path.basename(filePath).toLowerCase();
    const set = this._index.get(key);
    if (set) {
      set.delete(filePath);
      if (set.size === 0) this._index.delete(key);
    }
  }

  // ── Cache management ──────────────────────────────────────────────────────

  _key(filePath) {
    return filePath.toLowerCase();
  }

  _updateFromDocument(doc) {
    this._cache.set(this._key(doc.uri.fsPath), parseDocument(doc.getText()));
  }

  _parseFile(filePath) {
    const key = this._key(filePath);
    if (this._cache.has(key)) return this._cache.get(key);
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const result = parseDocument(text);
      this._cache.set(key, result);
      return result;
    } catch {
      return EMPTY;
    }
  }

  // ── Include resolution ────────────────────────────────────────────────────

  /**
   * Resolve an include path to an absolute path.
   *
   * Strategy:
   *   1. path.resolve(fromDir, rel)  — handles relative and absolute paths
   *   2. Workspace index lookup by basename, preferring the file whose path
   *      most closely matches the including file's location
   *
   * Returns the resolved absolute path or null if not found.
   */
  _resolveInclude(rel, fromDir) {
    // 1 — standard relative resolution
    const direct = path.resolve(fromDir, rel);
    if (fs.existsSync(direct)) return direct;

    // 2 — workspace index: search by basename
    const basename = path.basename(rel).toLowerCase();
    const candidates = this._index.get(basename);
    if (!candidates || candidates.size === 0) return null;

    // If `rel` contains a directory component (e.g. "libs/utils.inc"),
    // only accept a candidate whose path ends with that suffix.
    const relNorm = rel.replace(/\\/g, "/").toLowerCase();
    if (path.dirname(rel) !== ".") {
      for (const candidate of candidates) {
        if (candidate.replace(/\\/g, "/").toLowerCase().endsWith("/" + relNorm)) {
          return candidate;
        }
      }
      // No suffix match — nothing to return for an explicit subpath
      return null;
    }

    // Bare filename: pick the candidate with the most common path prefix
    return this._closestCandidate(candidates, fromDir);
  }

  /** Return the candidate whose directory path shares the longest prefix with fromDir. */
  _closestCandidate(candidates, fromDir) {
    const fromParts = fromDir.toLowerCase().split(path.sep);
    let best = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const candParts = path.dirname(candidate).toLowerCase().split(path.sep);
      let score = 0;
      const limit = Math.min(fromParts.length, candParts.length);
      for (let i = 0; i < limit; i++) {
        if (fromParts[i] === candParts[i]) score++;
        else break;
      }
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  // ── Symbol merging ────────────────────────────────────────────────────────

  _mergeIncludes(filePath, out, visited, isRoot) {
    const key = this._key(filePath);
    if (visited.has(key)) return;
    visited.add(key);

    const parsed = this._parseFile(filePath);

    // Current-file wins — don't overwrite symbols already present.
    // Functions from included files are marked so hover/completion can exclude them
    // from cursor-position scope checks (their line numbers belong to other files).
    for (const [name, fn] of Object.entries(parsed.functions)) {
      if (!(name in out.functions)) {
        out.functions[name] = isRoot ? fn : { ...fn, fromInclude: true };
      }
    }
    // Variables are only in scope from the file being edited.
    // Global variables in inherited files are not reliably accessible in 4DGL,
    // and local variables inside their functions are definitely not in scope.
    if (isRoot) {
      for (const [name, v] of Object.entries(parsed.variables)) {
        if (!(name in out.variables)) out.variables[name] = v;
      }
    }
    for (const [name, c] of Object.entries(parsed.constants)) {
      if (!(name in out.constants)) out.constants[name] = c;
    }

    const dir = path.dirname(filePath);
    for (const rel of parsed.includes) {
      const abs = this._resolveInclude(rel, dir);
      if (abs) this._mergeIncludes(abs, out, visited, false);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getSymbolsForDocument(uri) {
    const out = { functions: {}, variables: {}, constants: {} };
    this._mergeIncludes(uri.fsPath, out, new Set(), true);
    return out;
  }
}

module.exports = { DocumentManager };
