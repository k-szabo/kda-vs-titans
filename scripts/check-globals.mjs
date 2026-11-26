// Static check: every bare identifier used in js/*.js must resolve to a local
// binding, an import, or a known browser/JS global. Catches the class of bug
// where a refactor drops an import (ReferenceError only at runtime).
// Run: node scripts/check-globals.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let acorn;
try {
  acorn = require('acorn');
} catch {
  // Dev-only parser dependency, installed on demand (gitignored, never shipped).
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', 'acorn'], { stdio: 'inherit', shell: true });
  acorn = require('acorn');
}

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const jsDir = path.join(here, '..', 'js');

const GLOBALS = new Set([
  'console', 'window', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'URL', 'URLSearchParams',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  'matchMedia', 'getComputedStyle', 'alert', 'confirm', 'prompt',
  'innerWidth', 'innerHeight', 'devicePixelRatio', 'screen',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'RegExp', 'Date', 'Math', 'JSON', 'Intl', 'TextEncoder', 'TextDecoder',
  'Blob', 'File', 'FileReader', 'FormData', 'AbortController', 'AbortSignal',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'requestAnimationFrame', 'performance', 'crypto', 'atob', 'btoa',
  'undefined', 'NaN', 'Infinity', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'navigator', 'locationbar', 'open', 'close', 'addEventListener', 'removeEventListener',
  'AudioContext', 'OfflineAudioContext',
  'Deno',
  'Image', 'ImageBitmap', 'ClipboardItem',
  'HTMLElement', 'SVGElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'HTMLDialogElement', 'HTMLButtonElement',
  'HTMLInputElement', 'Document', 'Window',
]);

function checkFile(file) {
  const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const problems = [];
  const scopes = [new Set()];
  const refs = [];

  function declare(name) { if (name) scopes[scopes.length - 1].add(name); }
  function patternNames(node, cb) {
    if (!node) return;
    if (node.type === 'Identifier') cb(node.name);
    else if (node.type === 'ObjectPattern') node.properties.forEach((p) => { if (p.type === 'RestElement') patternNames(p.argument, cb); else patternNames(p.value, cb); });
    else if (node.type === 'ArrayPattern') node.elements.forEach((e) => patternNames(e, cb));
    else if (node.type === 'AssignmentPattern') patternNames(node.left, cb);
    else if (node.type === 'RestElement') patternNames(node.argument, cb);
  }

  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Import' || node.type === 'MetaProperty') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, null)); return; }
    switch (node.type) {
      case 'ImportDeclaration':
        node.specifiers.forEach((s) => declare(s.local.name));
        return;
      case 'FunctionDeclaration':
        if (node.id) declare(node.id.name);
        scopes.push(new Set());
        node.params.forEach((p) => patternNames(p, declare));
        walk(node.body, node);
        scopes.pop();
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        scopes.push(new Set());
        if (node.id) declare(node.id.name);
        node.params.forEach((p) => patternNames(p, declare));
        walk(node.body, node);
        scopes.pop();
        return;
      }
      case 'BlockStatement':
        scopes.push(new Set());
        node.body.forEach((n) => walk(n, node));
        scopes.pop();
        return;
      case 'VariableDeclaration':
        node.declarations.forEach((d) => { patternNames(d.id, declare); if (d.init) walk(d.init, node); });
        return;
      case 'ClassDeclaration':
        if (node.id) declare(node.id.name);
        return;
      case 'CatchClause':
        scopes.push(new Set());
        patternNames(node.param, declare);
        walk(node.body, node);
        scopes.pop();
        return;
      case 'Identifier': {
        const isDecl = parent && (
          (parent.type === 'VariableDeclarator' && parent.id === node) ||
          (parent.type === 'FunctionDeclaration' && parent.id === node) ||
          (parent.type === 'FunctionExpression' && parent.id === node) ||
          (parent.type === 'ClassDeclaration' && parent.id === node) ||
          (parent.type === 'ImportSpecifier' && parent.local === node) ||
          (parent.type === 'ImportDefaultSpecifier') ||
          (parent.type === 'ImportNamespaceSpecifier') ||
          (parent.type === 'LabeledStatement' && parent.label === node) ||
          (parent.type === 'BreakStatement' && parent.label === node) ||
          (parent.type === 'ContinueStatement' && parent.label === node)
        );
        const isProp = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
        const isKey = parent && ((parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key === node && !parent.computed);
        // Defer the lookup: declarations may come later in the same scope (hoisting).
        if (!isDecl && !isProp && !isKey) refs.push({ name: node.name, at: node.start, stack: [...scopes] });
        return;
      }
      default:
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue;
          const v = node[key];
          if (v && typeof v === 'object') walk(v, node);
        }
        return;
    }
  }
  walk(ast, null);
  // Scopes are live Sets: by now every declaration in the file is registered.
  for (const ref of refs) {
    let bound = GLOBALS.has(ref.name);
    if (!bound) for (let i = ref.stack.length - 1; i >= 0; i--) {
      if (ref.stack[i].has(ref.name)) { bound = true; break; }
    }
    if (!bound) problems.push(`${ref.name} @${ref.at}`);
  }
  // Object shorthand {x} counts as a use; declaration walk already bound it.
  return problems.filter((p) => !/^(arguments|this|super|new\.target)$/.test(p.split(' ')[0]));
}

const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
let bad = 0;
for (const file of files) {
  const problems = checkFile(file);
  if (problems.length > 0) { bad++; console.log(`UNRESOLVED in ${file}:`); problems.slice(0, 10).forEach((p) => console.log('  ' + p)); }
}
assert.equal(bad, 0, `${bad} file(s) with unresolved identifiers`);
console.log(`PASS: all identifiers resolve (${files.length} modules).`);
