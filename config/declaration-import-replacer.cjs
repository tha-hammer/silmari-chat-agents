const { existsSync } = require('node:fs');
const { dirname, extname, join, resolve } = require('node:path');

const DECLARATION_SUFFIX = '.d.ts';
const SOURCE_ALIAS_PREFIX = '@/';
const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);
const QUOTED_SPECIFIER_PATTERN =
  /(?<pathWithQuotes>(?<quote>["'])(?<specifier>[^"'\r\n]+)\k<quote>)/;

function extractSpecifier(orig) {
  const match = orig.match(QUOTED_SPECIFIER_PATTERN);
  if (!match?.groups) {
    throw new Error(`Unable to parse declaration module specifier: ${orig}`);
  }

  return match.groups;
}

function replaceSpecifier(orig, pathWithQuotes, quote, specifier) {
  return orig.replace(pathWithQuotes, () => `${quote}${specifier}${quote}`);
}

function declarationFileTarget(file, specifier) {
  return `${resolve(dirname(file), specifier)}${DECLARATION_SUFFIX}`;
}

function declarationIndexTarget(file, specifier) {
  return join(resolve(dirname(file), specifier), `index${DECLARATION_SUFFIX}`);
}

function indexSpecifier(specifier) {
  if (specifier.endsWith('/')) {
    return `${specifier}index.js`;
  }

  return `${specifier}/index.js`;
}

function declarationImportReplacer({ orig, file, config }) {
  const { pathWithQuotes, quote, specifier } = extractSpecifier(orig);
  config.output.debug('declaration import replacer', { file, specifier });

  if (specifier.startsWith(SOURCE_ALIAS_PREFIX)) {
    throw new Error(`Unresolved source alias "${specifier}" in ${file}`);
  }

  if (!specifier.startsWith('.')) {
    return orig;
  }

  if (SUPPORTED_EXTENSIONS.has(extname(specifier))) {
    return orig;
  }

  const fileTarget = declarationFileTarget(file, specifier);
  if (existsSync(fileTarget)) {
    return replaceSpecifier(orig, pathWithQuotes, quote, `${specifier}.js`);
  }

  const indexTarget = declarationIndexTarget(file, specifier);
  if (existsSync(indexTarget)) {
    return replaceSpecifier(
      orig,
      pathWithQuotes,
      quote,
      indexSpecifier(specifier)
    );
  }

  throw new Error(`No declaration target for "${specifier}" from ${file}`);
}

module.exports.default = declarationImportReplacer;
