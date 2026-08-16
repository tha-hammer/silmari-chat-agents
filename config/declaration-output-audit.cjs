const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');
const ts = require('typescript');
const replacerModule = require('./declaration-import-replacer.cjs');

const DECLARATION_FILE_PATTERN = /\.d\.(?:cts|mts|ts)$/;
const SOURCE_ALIAS_PREFIX = '@/';
const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

if (typeof replacerModule.default !== 'function') {
  throw new TypeError(
    'Declaration import replacer must export a default function'
  );
}

function declarationFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...declarationFiles(path));
      continue;
    }

    if (DECLARATION_FILE_PATTERN.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }

  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return node.moduleReference.expression;
  }

  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return node.argument.literal;
  }

  if (ts.isModuleDeclaration(node)) {
    return node.name;
  }

  return undefined;
}

function declarationTargetCandidates(file, specifier) {
  const absoluteSpecifier = resolve(file, '..', specifier);
  const extension = extname(specifier);
  const stem = absoluteSpecifier.slice(0, -extension.length);

  if (extension === '.js') {
    return [`${stem}.d.ts`];
  }

  if (extension === '.mjs') {
    return [`${stem}.d.mts`];
  }

  if (extension === '.cjs') {
    return [`${stem}.d.cts`];
  }

  return [absoluteSpecifier];
}

function validateModuleSpecifier(file, specifier) {
  if (specifier.startsWith(SOURCE_ALIAS_PREFIX)) {
    throw new Error(`Unresolved source alias "${specifier}" in ${file}`);
  }

  if (!specifier.startsWith('.')) {
    return;
  }

  const extension = extname(specifier);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported or extensionless declaration specifier "${specifier}" in ${file}`
    );
  }

  const candidates = declarationTargetCandidates(file, specifier);
  const targetExists = candidates.some((candidate) => existsSync(candidate));
  if (!targetExists) {
    throw new Error(`No declaration target for "${specifier}" from ${file}`);
  }
}

function auditDeclarationFile(file) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Unable to parse declaration file ${file}`);
  }

  function visit(node) {
    const candidate = moduleSpecifier(node);
    if (candidate && ts.isStringLiteralLike(candidate)) {
      validateModuleSpecifier(file, candidate.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function auditDeclarationTree(root) {
  if (!existsSync(root)) {
    throw new Error(`Declaration output directory does not exist: ${root}`);
  }

  const files = declarationFiles(root);
  if (files.length === 0) {
    throw new Error(
      `Declaration output directory contains no declarations: ${root}`
    );
  }

  for (const file of files) {
    auditDeclarationFile(file);
  }
}

module.exports.auditDeclarationTree = auditDeclarationTree;

if (require.main === module) {
  const root = process.argv[2];
  if (!root) {
    throw new Error(
      'Usage: node config/declaration-output-audit.cjs <declaration-directory>'
    );
  }

  auditDeclarationTree(resolve(root));
}
