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
    // Every function also records the file it came from (definedInFile), used both to
    // navigate there on a cross-link click and — for included-file functions only — to
    // show a "Defined in ..." line in hover text.
    for (const [name, fn] of Object.entries(parsed.functions)) {
      if (!(name in out.functions)) {
        out.functions[name] = isRoot
          ? { ...fn, definedInFile: filePath }
          : { ...fn, fromInclude: true, definedInFile: filePath };
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

  /**
   * Every file in the workspace classifiable as 4DGL:
   *   - anything matching the extensions this extension registers 4dgl for
   *     (.4dg/.4dgl/.lib/.inc — GLOB_PATTERN, also used for include resolution)
   *   - any glob a user has manually mapped to the "4dgl" language via the
   *     `files.associations` setting (what VS Code's "Configure File Association
   *     for '.ext'..." command writes to)
   *   - any currently-open document a user switched to 4dgl one-off via
   *     "Change Language Mode", without persisting an association
   */
  async _findClassifiedFiles() {
    const paths = new Set();

    for (const uri of await vscode.workspace.findFiles(GLOB_PATTERN)) {
      paths.add(uri.fsPath);
    }

    const associations = vscode.workspace.getConfiguration("files").get("associations") || {};
    for (const [pattern, languageId] of Object.entries(associations)) {
      if (languageId !== "4dgl") continue;
      const glob = pattern.includes("**") ? pattern : `**/${pattern}`;
      for (const uri of await vscode.workspace.findFiles(glob)) {
        paths.add(uri.fsPath);
      }
    }

    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "4dgl") paths.add(doc.uri.fsPath);
    }

    return paths;
  }

  /**
   * Union of every function defined in every 4DGL-classified file in the workspace —
   * unlike getSymbolsForDocument, membership here doesn't depend on being reachable
   * through anyone's #INCLUDE chain. Where a name is defined in more than one file,
   * `preferredUri` (typically the active editor) wins so its live unsaved buffer is
   * what's shown, matching getSymbolsForDocument's "current file wins" behavior.
   */
  async getRepositorySymbols(preferredUri) {
    const paths = [...(await this._findClassifiedFiles())];
    if (preferredUri) {
      const key = this._key(preferredUri.fsPath);
      const idx = paths.findIndex((p) => this._key(p) === key);
      if (idx > 0) {
        paths.splice(idx, 1);
        paths.unshift(preferredUri.fsPath);
      }
    }

    const functions = {};
    for (const filePath of paths) {
      const parsed = this._parseFile(filePath);
      for (const [name, fn] of Object.entries(parsed.functions)) {
        if (!(name in functions)) functions[name] = { ...fn, definedInFile: filePath };
      }
    }
    return { functions };
  }
}

module.exports = { DocumentManager };
