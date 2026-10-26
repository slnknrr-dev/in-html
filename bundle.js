// bundle.js - ES module bundler with scope hoisting and side-effect-aware tree shaking.
//
//   import { bundle } from './bundle.js';
//   const { code, warnings, stats } = bundle({
//     entries: [{ file: '/abs/app/main.js' } | { code: 'import ...', file: '/abs/app/index.html#1' }],
//     root: '/abs/repo',     // '/x.js' specifiers resolve against it
//   });
//
// The result is one module script (no import/export) whose top level is the union of the live
// top-level declarations of every reachable module, in execution order, renamed only where names
// would collide or be captured. A declaration is dropped when nothing live references it and its
// initializer has no side effects. Side effects are judged statically:
//   - literals, functions, classes without impure static parts, object/array literals, reads and
//     arithmetic are pure; so are calls of known-pure builtins (Object.freeze, Math.*, new Map, ...),
//     non-mutating builtin methods (map, slice, join, ...) and calls of functions (module-level or
//     IIFEs) whose bodies only mutate their own fresh locals;
//   - `/*#__PURE__*/` before a call or `new` marks it pure;
//   - a top-level statement that only mutates module bindings (`T.x = 1`, `Object.assign(T, ...)`,
//     `list.push(...)`, a loop filling a table) is kept exactly when one of those bindings is live.
// Supported: static imports/exports in every form, re-exports, `export *`, namespace imports (static
// `ns.x` accesses resolve to `x`; other uses materialize a frozen namespace object), JSON modules
// (`with { type: 'json' }`), dynamic `import('./x.js')` of relative specifiers (bundled and evaluated
// eagerly) and `new URL('./asset', import.meta.url)` (inlined as a data: URL). `new URL('./x.js?bundle',
// import.meta.url)` inlines instead an ES module bundle of ./x.js for another JavaScript host (a Node server that a
// page writes out): its default export is the module namespace of ./x.js, gzip-compressed
// (data:application/gzip;base64,…); assetBundle(file, root) returns the same bytes (the development server answers
// `x.js?bundle` with them).
// Variants: with `variant: 'offline'`, an import of ./x.js resolves to ./x.offline.js when that file exists (an
// artifact without network code gets modules that keep the same exports without the network).
//
// ALGORITHM (run()), each phase feeding the next:
//   1. load: parse each module (parse.js) and analyse scopes (scope.js); record imports/exports; recurse into deps.
//   2. sort: depth-first post-order over static deps = the ES module evaluation order (a dep runs before its
//      importer; cycles are cut where first revisited, exactly like the spec's DFS). Dynamic deps are appended after
//      static ones because they are evaluated eagerly here (warned).
//   3. buildUnits: split every module's top level into UNITS (one per declarator / declaration / statement), each
//      with the module bindings it declares, the bindings it references, and a purity verdict (class Effects).
//   4. liveness: worklist mark-and-sweep. Roots = every impure unit (it must run) + namespaces of import() targets.
//      Marking a unit marks the bindings it references; marking a binding marks its declaring units and any
//      mutation-only units ATTACHED to it (T.x = 1 lives exactly as long as T). Unmarked units are dropped.
//   5. naming: keep each emitted binding's own name unless it collides with a name already used at top level, a
//      global read anywhere, or an inner declaration at a site that will be rewritten to it (sitesOk).
//   6. emission: per module, splice the original source text of live units with a sorted edit list (renames,
//      namespace member accesses, inlined URLs). No AST printing: source slices keep the original text and
//      every literal exactly as written (comments too; finishJS strips them when it minifies the tokens).
// Why unit granularity (not whole modules, not expressions): module-level dropping removes too little (a utility
// library is 90% unused); expression-level DCE needs a full optimiser. Top-level declarations are where library
// dead code lives, and a declaration's purity can be judged locally.
// Why our own bundler: zero dependencies is a repository rule, and the output must be deterministic and auditable.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse, walk } from './parse.js';
import { analyze, patternIds, Binding } from './scope.js';
import { dataURI } from './mime.js';

// ---------------------------------------------------------------------------------------------
// Purity tables

// Purity tables are deliberately allowlists: a call not listed is impure. A false 'impure' only costs bytes (code is
// kept); a false 'pure' silently deletes behaviour. Every entry is a builtin that, given ordinary arguments, neither
// mutates nor observes external state. Known approximation: a getter or valueOf on an argument object could still
// run arbitrary code (JSON.stringify calls toJSON); the build assumes ordinary data, as every mainstream bundler does.
const PURE_GLOBAL_CALLS = new Set([
  'Object.freeze', 'Object.seal', 'Object.create', 'Object.keys', 'Object.values', 'Object.entries',
  'Object.fromEntries', 'Object.getOwnPropertyNames', 'Object.getOwnPropertySymbols', 'Object.getPrototypeOf',
  'Object.getOwnPropertyDescriptor', 'Object.getOwnPropertyDescriptors', 'Object.is', 'Object.isFrozen',
  'Object.hasOwn', 'Array.from', 'Array.of', 'Array.isArray', 'String.fromCharCode', 'String.fromCodePoint',
  'String.raw', 'Number.isInteger', 'Number.isFinite', 'Number.isNaN', 'Number.isSafeInteger',
  'Number.parseFloat', 'Number.parseInt', 'JSON.parse', 'JSON.stringify', 'Symbol', 'Symbol.for', 'BigInt',
  'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'Date.now', 'Date.UTC', 'RegExp', 'Array', 'Object',
  'Reflect.ownKeys', 'Reflect.has', 'Reflect.getPrototypeOf', 'structuredClone', 'Intl.getCanonicalLocales',
  'Intl.supportedValuesOf', 'Promise.resolve', 'Promise.reject', 'CSS.escape',
]);
const PURE_GLOBAL_PREFIXES = ['Math.'];
const PURE_CONSTRUCTORS = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Array', 'Object', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'TextEncoder', 'TextDecoder', 'ArrayBuffer', 'DataView',
  'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'URL', 'URLSearchParams', 'Blob',
  'Headers', 'Intl.Collator', 'Intl.NumberFormat', 'Intl.DateTimeFormat', 'Intl.PluralRules',
  'Intl.Segmenter', 'Intl.DisplayNames', 'Intl.ListFormat', 'Intl.RelativeTimeFormat', 'Intl.Locale',
  'Proxy', 'AbortController', 'FormData', 'DOMParser',
]);
// Builtin methods that never mutate their receiver (callbacks are checked separately).
// Matched by method NAME alone, whatever the receiver: `x.get()` is assumed pure for any x. This is the main
// heuristic risk of the table (a user object with an impure `get` or `forEach` would be misjudged).
// KNOWN DEFECT: 'call', 'apply' and 'bind' are listed, so `init.call(null)` / `setup.apply(o)` at top level is judged
// pure and, being a statement that mutates no binding, is DROPPED even though it runs arbitrary user code. ('bind'
// alone is pure: it only creates a function.) Fix: remove 'call'/'apply' or check the receiver with calleePure().
// Also 'test'/'exec' advance lastIndex on /g and /y regexes (a mutation), accepted as harmless at module level.
const PURE_METHODS = new Set([
  'map', 'filter', 'reduce', 'reduceRight', 'slice', 'concat', 'join', 'split', 'indexOf', 'lastIndexOf',
  'includes', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flat', 'flatMap', 'keys',
  'values', 'entries', 'at', 'toString', 'toFixed', 'toPrecision', 'toLowerCase', 'toUpperCase',
  'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd', 'repeat',
  'replace', 'replaceAll', 'startsWith', 'endsWith', 'charAt', 'charCodeAt', 'codePointAt', 'substring',
  'substr', 'normalize', 'localeCompare', 'match', 'matchAll', 'search', 'test', 'exec', 'get', 'has',
  'forEach', 'toSorted', 'toReversed', 'toSpliced', 'with', 'hasOwnProperty', 'valueOf', 'getTime',
  'format', 'formatToParts', 'resolvedOptions', 'select', 'encode', 'decode', 'subarray', 'toISOString',
  'toJSON', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds',
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'bind', 'call', 'apply', 'description',
  'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleUpperCase', 'getUint8', 'getUint16', 'getUint32',
]);
// Builtin methods that mutate their receiver only.
// A mutating call is acceptable when its receiver is a fresh local or a module binding: then it is a mutation-only
// statement that lives or dies with that binding (see ctx.mutated below), the pattern of table-filling code.
const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill',
  'copyWithin', 'set', 'add', 'delete', 'clear', 'setUint8', 'setUint16', 'setUint32', 'setInt8']);
// Object.* functions that only mutate their first argument.
const MUTATING_GLOBAL_CALLS = new Set(['Object.assign', 'Object.defineProperty', 'Object.defineProperties',
  'Object.setPrototypeOf']);

const isFunc = (n) => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

// "a.b.c" for a member chain rooted at a global identifier, else null.
// Only unbound roots count ($binding null): a local named Math or Object must never match the purity tables.
function globalPath(node) {
  const parts = [];
  let n = node;
  while (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
    parts.unshift(n.property.name);
    n = n.object;
  }
  if (n.type !== 'Identifier' || n.$binding) return null;
  parts.unshift(n.name);
  return parts.join('.');
}

// Root identifier of a member chain (`a` in `a.b[c].d`), else null.
function memberRoot(node) {
  let n = node;
  while (n.type === 'MemberExpression') n = n.object;
  return n.type === 'Identifier' ? n : null;
}

function isWithin(scope, root) {
  for (let s = scope; s; s = s.parent) if (s === root) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Side-effect analysis
//
// ctx.root:      scope whose (non-module) bindings count as locals that may be written freely;
//                the module scope for top-level statements, the function scope for function bodies.
//                IIFEs and callbacks are analyzed in their caller's ctx (they run synchronously).
// ctx.mutated:   Set collecting module-level bindings that may be mutated, or null when mutating
//                anything outside ctx.root is a side effect (function bodies).
// ctx.thisFresh: `this` is a fresh object (constructors and instance field initializers).

class Effects {
  constructor(mod, bundler) {
    this.mod = mod;
    this.bundler = bundler;
    this.stack = bundler.fnStack;   // shared across modules: frames { fn, key, tainted }
  }

  isModuleBinding(b) {
    return !!b && b.scope === this.mod.info.moduleScope;
  }

  isLocal(b, ctx) {
    return !!b && !!ctx.root && !this.isModuleBinding(b) && isWithin(b.scope, ctx.root);
  }

  // A local binding that certainly holds a fresh object (safe to mutate).
  // Fresh = initialised with an object no one else can hold (literal, pure constructor, copying method) and never
  // reassigned. Mutating such an object is invisible outside the function, so it is not a side effect.
  isFreshLocal(b, ctx) {
    if (!this.isLocal(b, ctx) || b.writes > 0) return false;
    if (b.kind !== 'const' && b.kind !== 'let' && b.kind !== 'var') return false;
    const d = b.decl;
    return !!d && d.type === 'VariableDeclarator' && d.id.type === 'Identifier' && !!d.init && this.isFreshExpr(d.init);
  }

  isFreshExpr(e) {
    switch (e.type) {
      case 'ObjectExpression': case 'ArrayExpression': case 'Literal': case 'TemplateLiteral':
      case 'ArrowFunctionExpression': case 'FunctionExpression': case 'ClassExpression':
        return true;
      case 'NewExpression': {
        const gp = globalPath(e.callee);
        return !!gp && PURE_CONSTRUCTORS.has(gp);
      }
      case 'CallExpression': {
        const c = e.callee;
        const gp = globalPath(c);
        if (gp) return PURE_GLOBAL_CALLS.has(gp) || PURE_GLOBAL_PREFIXES.some((p) => gp.startsWith(p));
        return c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' &&
          ['map', 'filter', 'slice', 'concat', 'split', 'flat', 'flatMap', 'toSorted', 'toReversed', 'toSpliced',
            'subarray'].includes(c.property.name);
      }
      default: return false;
    }
  }

  // A write through identifier `id` (the whole binding, or one of its members when `memberOnly`).
  // Returns true when the write is a side effect.
  write(id, ctx, memberOnly) {
    const b = id.$binding;
    if (!b) return true;                                   // global
    if (this.isLocal(b, ctx)) return memberOnly ? !this.isFreshLocal(b, ctx) : false;
    if (ctx.mutated && (this.isModuleBinding(b) && (memberOnly || b.kind !== 'import'))) {
      ctx.mutated.add(b);
      return false;
    }
    return true;
  }

  // Is the call/new `node` annotated with /*#__PURE__*/ (or /*@__PURE__*/)?
  // Scans backwards over whitespace and '(' from the node start: covers `/*#__PURE__*/ f()` and
  // `(/*#__PURE__*/ f())`. Both '#' and '@' spellings are accepted (the Rollup/Terser/esbuild convention).
  annotated(node) {
    const src = this.mod.src;
    let i = node.start - 1;
    while (i >= 0 && /[\s(]/.test(src[i])) i--;
    if (i < 1 || src[i] !== '/' || src[i - 1] !== '*') return false;
    const open = src.lastIndexOf('/*', i);
    return open >= 0 && /^\/\*\s*[#@]__PURE__\s*\*\/$/.test(src.slice(open, i + 1));
  }

  // Calling `fn` (declared in this module) has no side effects. Memoized on the node. Recursion is
  // assumed pure; results computed under that assumption are cached only when they turn out impure.
  // Recursion: a function already on the analysis stack is optimistically assumed pure (otherwise every recursive
  // function would be impure). Frames above the recursion point are marked `tainted`, and a tainted 'pure' result
  // is not memoised, because it depended on an assumption; an 'impure' result is final and always cached. The stack
  // is shared across modules (bundler.fnStack) so mutual recursion through imports is detected too.
  fnPure(fn, thisFresh = false) {
    const key = thisFresh ? 'ctor' : 'fn';
    const memo = fn.$pure || (fn.$pure = {});
    if (key in memo) return memo[key];
    const stack = this.stack;
    const idx = stack.findIndex((f) => f.fn === fn && f.key === key);
    if (idx >= 0) {
      for (let j = idx + 1; j < stack.length; j++) stack[j].tainted = true;
      return true;
    }
    const frame = { fn, key, tainted: false };
    stack.push(frame);
    let pure;
    try {
      pure = !this.inlineImpure(fn, { root: fn.$own, mutated: null, thisFresh });
    } finally {
      stack.pop();
    }
    if (!pure || !frame.tainted) memo[key] = pure;
    return pure;
  }

  // Calling the function behind identifier `id` (local, module-level or imported) is pure.
  calleePure(id) {
    const b = id.$binding;
    if (!b) return false;
    if (b.kind === 'import') {
      const r = this.bundler.resolveBinding(b, this.mod);
      if (!r.binding || !r.module.fx) return false;
      const fn = r.module.fx.bindingFunction(r.binding);
      return !!fn && r.module.fx.fnPure(fn);
    }
    const fn = this.bindingFunction(b);
    return !!fn && this.fnPure(fn);
  }

  // `ns.name` where ns is a namespace import: the identifier-like target binding, else null.
  nsTarget(member) {
    if (member.type !== 'MemberExpression' || member.computed || member.object.type !== 'Identifier') return null;
    const b = member.object.$binding;
    if (!b || b.kind !== 'import') return null;
    const ns = this.bundler.resolveBinding(b, this.mod).ns;
    const r = ns && this.bundler.resolveExport(ns, member.property.name);
    return r && r.binding ? r : null;
  }

  // Running the body of `fn` inside `ctx` (IIFEs and synchronous callbacks).
  // async/generator bodies do not run (fully) at call time: their effects escape the analysed moment, so impure.
  // Arrows inherit `this` freshness from the caller; ordinary functions only when they are the constructor itself.
  inlineImpure(fn, ctx) {
    if (fn.async || fn.generator) return true;
    const inner = { root: ctx.root || fn.$own, mutated: ctx.mutated, thisFresh: fn.type === 'ArrowFunctionExpression' ? ctx.thisFresh : !!ctx.thisFresh && ctx.root === fn.$own };
    for (const p of fn.params) if (this.pattern(p, inner)) return true;
    return fn.body.type === 'BlockStatement' ? this.stmts(fn.body.body, inner) : this.expr(fn.body, inner);
  }

  // Function node behind a binding (function declaration or never-reassigned const/let = function).
  bindingFunction(b) {
    const d = b && b.decl;
    if (!d) return null;
    if (d.type === 'FunctionDeclaration') return d;
    if (d.type === 'VariableDeclarator' && b.writes === 0 && isFunc(d.init) && d.id.type === 'Identifier') return d.init;
    return null;
  }

  stmts(list, ctx) {
    for (const s of list) if (this.stmt(s, ctx)) return true;
    return false;
  }

  // Returns true when executing the statement may have side effects.
  // Control flow is analysed conservatively by union: a statement is impure if ANY branch could be. Termination is
  // ignored (an infinite pure loop counts as pure); throw is impure (it is observable).
  stmt(s, ctx) {
    if (!s) return false;
    switch (s.type) {
      case 'EmptyStatement': case 'FunctionDeclaration': case 'BreakStatement': case 'ContinueStatement':
        return false;
      case 'ClassDeclaration': return this.classImpure(s, ctx);
      case 'VariableDeclaration':
        for (const d of s.declarations) {
          if (d.init && this.expr(d.init, ctx)) return true;
          if (this.pattern(d.id, ctx)) return true;
        }
        return false;
      case 'ExpressionStatement': return this.expr(s.expression, ctx);
      case 'BlockStatement': return this.stmts(s.body, ctx);
      case 'IfStatement':
        return this.expr(s.test, ctx) || this.stmt(s.consequent, ctx) || this.stmt(s.alternate, ctx);
      case 'ForStatement':
        return !!(s.init && (s.init.type === 'VariableDeclaration' ? this.stmt(s.init, ctx) : this.expr(s.init, ctx))) ||
          !!(s.test && this.expr(s.test, ctx)) || !!(s.update && this.expr(s.update, ctx)) || this.stmt(s.body, ctx);
      case 'ForInStatement': case 'ForOfStatement':
        if (s.await) return true;
        if (s.left.type === 'VariableDeclaration') { if (this.stmt(s.left, ctx)) return true; }
        else if (this.assignTarget(s.left, ctx)) return true;
        return this.expr(s.right, ctx) || this.stmt(s.body, ctx);
      case 'WhileStatement': case 'DoWhileStatement':
        return this.expr(s.test, ctx) || this.stmt(s.body, ctx);
      case 'ReturnStatement': return s.argument ? this.expr(s.argument, ctx) : false;
      case 'LabeledStatement': return this.stmt(s.body, ctx);
      case 'SwitchStatement':
        if (this.expr(s.discriminant, ctx)) return true;
        for (const c of s.cases) if ((c.test && this.expr(c.test, ctx)) || this.stmts(c.consequent, ctx)) return true;
        return false;
      case 'TryStatement':
        return this.stmt(s.block, ctx) || (s.handler ? this.stmt(s.handler.body, ctx) : false) || this.stmt(s.finalizer, ctx);
      default:
        return true; // throw, debugger, with, module declarations
    }
  }

  classImpure(c, ctx) {
    if (c.superClass && this.expr(c.superClass, ctx)) return true;
    for (const m of c.body.body) {
      if (m.type === 'StaticBlock') {
        if (this.stmts(m.body, { root: ctx.root, mutated: ctx.mutated })) return true;
        continue;
      }
      if (m.computed && this.expr(m.key, ctx)) return true;
      if (m.type === 'PropertyDefinition' && m.static && m.value && this.expr(m.value, { root: ctx.root, mutated: ctx.mutated })) {
        return true;
      }
    }
    return false;
  }

  // `new C(...)` of a class declared in this module: constructor and instance fields only touch `this`.
  // `new C()` of a local class: pure only without a superclass (super() runs code we would have to follow) and when
  // instance field initialisers and the constructor touch nothing but `this` (thisFresh) and their own locals.
  newPure(d) {
    if (d.superClass) return false;
    for (const m of d.body.body) {
      if (m.type === 'PropertyDefinition' && !m.static && (m.computed || (m.value &&
        this.expr(m.value, { root: m.$own, mutated: null, thisFresh: true })))) return false;
      if (m.kind === 'constructor' && !this.fnPure(m.value, true)) return false;
    }
    return true;
  }

  // Default values in binding patterns.
  pattern(p, ctx) {
    if (!p) return false;
    switch (p.type) {
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') { if (this.pattern(prop.argument, ctx)) return true; continue; }
          if (prop.computed && this.expr(prop.key, ctx)) return true;
          if (this.pattern(prop.value, ctx)) return true;
        }
        return false;
      case 'ArrayPattern': return p.elements.some((e) => this.pattern(e, ctx));
      case 'RestElement': return this.pattern(p.argument, ctx);
      case 'AssignmentPattern': return this.pattern(p.left, ctx) || this.expr(p.right, ctx);
      default: return false;
    }
  }

  // Assignment target (identifier, member or pattern). Returns true when the write is a side effect.
  assignTarget(t, ctx) {
    switch (t.type) {
      case 'Identifier': return this.write(t, ctx, false);
      case 'MemberExpression': {
        if (this.memberParts(t, ctx)) return true;
        let n = t;
        while (n.type === 'MemberExpression') n = n.object;
        if (n.type === 'ThisExpression') return !ctx.thisFresh;
        if (n.type !== 'Identifier') return true;
        return this.write(n, ctx, true);
      }
      case 'ObjectPattern':
        for (const prop of t.properties) {
          if (prop.type === 'RestElement') { if (this.assignTarget(prop.argument, ctx)) return true; continue; }
          if (prop.computed && this.expr(prop.key, ctx)) return true;
          if (this.assignTarget(prop.value, ctx)) return true;
        }
        return false;
      case 'ArrayPattern': return t.elements.some((e) => e && this.assignTarget(e, ctx));
      case 'RestElement': return this.assignTarget(t.argument, ctx);
      case 'AssignmentPattern': return this.assignTarget(t.left, ctx) || this.expr(t.right, ctx);
      default: return true;
    }
  }

  // Evaluating the computed parts and the base of a member chain (not the root identifier itself).
  memberParts(m, ctx) {
    let n = m;
    while (n.type === 'MemberExpression') {
      if (n.computed && this.expr(n.property, ctx)) return true;
      n = n.object;
    }
    return n.type !== 'Identifier' && n.type !== 'ThisExpression' && this.expr(n, ctx);
  }

  // Call arguments: function arguments run synchronously inside the callee (builtins) - their bodies
  // are analyzed in the caller's ctx.
  args(list, ctx) {
    for (const a of list) {
      if (isFunc(a)) { if (this.inlineImpure(a, ctx)) return true; }
      else if (this.expr(a.type === 'SpreadElement' ? a.argument : a, ctx)) return true;
    }
    return false;
  }

  // Root of a receiver chain is an unresolved global (document, location, console, ...)?
  globalRooted(n) {
    while (n.type === 'MemberExpression' || n.type === 'CallExpression' || n.type === 'ChainExpression') {
      n = n.type === 'MemberExpression' ? n.object : n.type === 'CallExpression' ? n.callee : n.expression;
    }
    return n.type === 'Identifier' && !n.$binding;
  }

  // Decision ladder for calls, most specific first: #__PURE__ annotation, known constructors / local classes, IIFE
  // (body analysed inline), global builtins (pure or receiver-mutating), local/imported functions (fnPure), namespace
  // members, builtin methods by name. Anything else, including any call rooted at a global object (document.x(),
  // console.log()), is impure.
  call(e, ctx) {
    const c = e.callee.type === 'ChainExpression' ? e.callee.expression : e.callee;
    if (this.annotated(e)) return this.args(e.arguments, ctx) || (c.type === 'MemberExpression' && this.memberParts(c, ctx));
    if (e.type === 'NewExpression') {
      const gp = globalPath(c);
      if (gp && PURE_CONSTRUCTORS.has(gp)) return this.args(e.arguments, ctx);
      if (c.type === 'Identifier' && c.$binding && c.$binding.decl && c.$binding.decl.type === 'ClassDeclaration' &&
        c.$binding.writes === 0 && this.newPure(c.$binding.decl)) return this.args(e.arguments, ctx);
      return true;
    }
    if (isFunc(c)) return this.inlineImpure(c, ctx) || this.args(e.arguments, ctx);   // IIFE
    const gp = globalPath(c);
    if (gp) {
      if (PURE_GLOBAL_CALLS.has(gp) || PURE_GLOBAL_PREFIXES.some((p) => gp.startsWith(p))) return this.args(e.arguments, ctx);
      if (MUTATING_GLOBAL_CALLS.has(gp) && e.arguments.length) {
        const [target, ...rest] = e.arguments;
        if (target.type === 'ObjectExpression' || target.type === 'ArrayExpression') {
          return this.expr(target, ctx) || this.args(rest, ctx);
        }
        if (target.type !== 'Identifier' && target.type !== 'MemberExpression') return true;
        return this.assignTarget(target, ctx) || this.args(rest, ctx);
      }
      return true;
    }
    if (c.type === 'Identifier') return !this.calleePure(c) || this.args(e.arguments, ctx);
    const nsr = this.nsTarget(c);
    if (nsr) {
      const fn = nsr.module.fx && nsr.module.fx.bindingFunction(nsr.binding);
      return !(fn && nsr.module.fx.fnPure(fn)) || this.args(e.arguments, ctx);
    }
    if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
      const name = c.property.name;
      const obj = c.object;
      if (obj.type === 'Super' || obj.type === 'ThisExpression' || this.globalRooted(obj)) return true;
      if (PURE_METHODS.has(name)) return this.expr(obj, ctx) || this.args(e.arguments, ctx);
      if (MUTATING_METHODS.has(name)) {
        if (obj.type === 'ArrayExpression' || obj.type === 'ObjectExpression' || obj.type === 'NewExpression') {
          return this.expr(obj, ctx) || this.args(e.arguments, ctx);
        }
        if (obj.type !== 'Identifier' && obj.type !== 'MemberExpression') return true;
        return this.assignTarget(obj, ctx) || this.args(e.arguments, ctx);
      }
    }
    return true;
  }

  // Returns true when evaluating the expression may have side effects.
  expr(e, ctx) {
    if (!e) return false;
    switch (e.type) {
      case 'Identifier': case 'Literal': case 'ThisExpression': case 'MetaProperty': case 'Super':
      case 'FunctionExpression': case 'ArrowFunctionExpression': case 'PrivateIdentifier':
        return false;
      case 'ClassExpression': return this.classImpure(e, ctx);
      case 'TemplateLiteral': return e.expressions.some((x) => this.expr(x, ctx));
      // A tag is an arbitrary function call; only String.raw is known pure.
      case 'TaggedTemplateExpression':
        return globalPath(e.tag) !== 'String.raw' || e.quasi.expressions.some((x) => this.expr(x, ctx));
      case 'ArrayExpression': return e.elements.some((x) => x && this.expr(x.type === 'SpreadElement' ? x.argument : x, ctx));
      case 'ObjectExpression':
        return e.properties.some((p) => p.type === 'SpreadElement' ? this.expr(p.argument, ctx)
          : (p.computed && this.expr(p.key, ctx)) || this.expr(p.value, ctx));
      case 'UnaryExpression':
        if (e.operator === 'delete') return e.argument.type !== 'MemberExpression' || this.assignTarget(e.argument, ctx);
        return this.expr(e.argument, ctx);
      case 'UpdateExpression': return this.assignTarget(e.argument, ctx);
      case 'BinaryExpression': case 'LogicalExpression': return this.expr(e.left, ctx) || this.expr(e.right, ctx);
      case 'ConditionalExpression':
        return this.expr(e.test, ctx) || this.expr(e.consequent, ctx) || this.expr(e.alternate, ctx);
      case 'SequenceExpression': return e.expressions.some((x) => this.expr(x, ctx));
      case 'AssignmentExpression': return this.assignTarget(e.left, ctx) || this.expr(e.right, ctx);
      case 'MemberExpression': return this.expr(e.object, ctx) || (e.computed && this.expr(e.property, ctx));
      case 'ChainExpression': return this.expr(e.expression, ctx);
      case 'CallExpression': case 'NewExpression': return this.call(e, ctx);
      case 'SpreadElement': return this.expr(e.argument, ctx);
      default: return true; // await, yield, import(), patterns in expression position
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Module graph

// One node of the module graph. `edits` are text replacements on `src` applied at emission; `units` are the
// top-level pieces that liveness keeps or drops.
class Module {
  constructor(id, src, kind = 'js') {
    this.id = id;                 // absolute path, or `<html path>#<n>` for inline scripts
    this.src = src;
    this.kind = kind;             // 'js' | 'json'
    this.deps = [];               // { source, module, node } for static imports / re-exports, in order
    this.dynamicDeps = [];        // modules referenced by import()
    this.localExports = new Map(); // exported name -> Binding
    this.reexports = new Map();   // exported name -> { module, name } (name '*' = namespace)
    this.stars = [];              // export * from
    this.units = [];
    this.nsName = null;
    this.nsNeeded = false;
    this.edits = [];
  }
}

export class BundleError extends Error {}

export function bundle(options) {
  const b = new Bundler(options);
  return b.run();
}

// ES module bundle of `file` for another JavaScript host (`?bundle` assets): the module namespace of `file` is the
// default export, so every export stays reachable; gzip with a zero mtime and an unknown OS byte, so the bytes are the
// same on every platform. -> { bytes: Uint8Array, files, warnings }
// Reproducible gzip: header bytes 4..7 (MTIME) zeroed and byte 9 (OS) set to 255 'unknown', so identical input gives
// identical bytes on every platform and run; without this every build would change the artifact (and its --check).
export function assetBundle(file, root = process.cwd(), readFile = undefined) {
  const key = JSON.stringify('bundle:' + path.basename(file));
  const r = bundle({
    entries: [{ file: file + '#1', code: `import * as ns from ${JSON.stringify('./' + path.basename(file))};\nglobalThis[Symbol.for(${key})] = ns;\n` }],
    root, readFile,
  });
  const code = r.code + `\nexport default globalThis[Symbol.for(${key})];\n`;
  const gz = zlib.gzipSync(Buffer.from(code, 'utf8'), { level: 9 });
  gz[4] = gz[5] = gz[6] = gz[7] = 0;
  gz[9] = 255;
  return { bytes: new Uint8Array(gz.buffer, gz.byteOffset, gz.length), files: r.files, warnings: r.warnings };
}

// Per-module output for multi-file deployments: the same module graph and liveness, but every module keeps its own
// file and scope. splitModules({ entries, root, readFile, warn, outPath(absFile) -> 'dir/file.js' }) ->
//   { modules: [{ id, out, code, inline }], assets: [{ file, out }], files, warnings, stats }
// Dead top-level declarations and unused imports are dropped; imports point straight at the module that declares a
// binding (re-export barrels disappear unless a namespace object is needed); static namespace member accesses
// (`V.x`) become named imports; `import()` and `new URL('./asset', import.meta.url)` keep working with
// rewritten specifiers. `out` is null for inline entries (their code goes back into the page).
export function splitModules(options) {
  const b = new Bundler({ ...options, split: true });
  return b.runSplit(options.outPath);
}

class Bundler {
  constructor({ entries, root = process.cwd(), readFile = (f) => fs.readFileSync(f), warn, split = false, variant = null } = {}) {
    this.entries = entries;
    this.variant = variant;
    this.split = split;
    this.root = root;
    this.readFile = readFile;
    this.modules = new Map();
    this.order = [];
    this.warnings = [];
    this.warn = warn || ((m) => this.warnings.push(m));
    this.assetDeps = new Set();
  }

  // Resolution is intentionally minimal: relative and root-absolute paths only, with explicit extensions. No bare
  // specifiers (no node_modules, no import maps): every dependency must be a file in the repository, which is what
  // makes the artifacts self-contained and the zero-network audit meaningful. URL imports fail fast for the same
  // reason. `#n` suffixes of inline-script ids are stripped so they resolve relative to their HTML page.
  // Variant: x.js -> x.offline.js when present, so the offline artifact receives a network-free implementation with
  // the same exports, chosen at build time rather than by runtime feature checks that would still ship the code.
  resolve(spec, from) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec) && !spec.startsWith('file:')) {
      throw new BundleError(`${from}: cannot bundle URL import "${spec}" (single-file output is offline)`);
    }
    let file;
    const clean = spec.replace(/[?#].*$/, '');
    if (spec.startsWith('/')) file = path.join(this.root, clean);
    else if (spec.startsWith('./') || spec.startsWith('../')) file = path.resolve(path.dirname(from.replace(/#\d+$/, '')), clean);
    else throw new BundleError(`${from}: bare import "${spec}" is not supported (use a relative path)`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new BundleError(`${from}: cannot resolve "${spec}" (${file})`);
    if (this.variant) {
      const alt = file.replace(/\.(m?js)$/, `.${this.variant}.$1`);
      if (alt !== file && fs.existsSync(alt)) return alt;
    }
    return file;
  }

  // Memoised by id: each module is parsed once even when imported from many places (and cycles terminate).
  // JSON modules get a synthetic `default` binding; they have no AST and no scope.
  load(id, code = null, attrs = null) {
    let m = this.modules.get(id);
    if (m) return m;
    const isJson = (attrs && attrs.type === 'json') || /\.json$/i.test(id);
    const src = code !== null ? code : String(this.readFile(id)).replace(/^\ufeff/, '');
    m = new Module(id, src, isJson ? 'json' : 'js');
    this.modules.set(id, m);
    if (m.kind === 'json') {
      try { JSON.parse(src); } catch (e) { throw new BundleError(`${id}: invalid JSON: ${e.message}`); }
      m.jsonBinding = new Binding('json', 'const', null);
      m.localExports.set('default', m.jsonBinding);
      return m;
    }
    try {
      m.ast = parse(src, { sourceType: 'module', file: id });
    } catch (e) {
      throw new BundleError(e.message);
    }
    m.info = analyze(m.ast);
    this.annotateParents(m);
    this.collectModuleRecords(m);
    return m;
  }

  // Parent pointers ($p) and parent keys ($k) let later passes ask "is this identifier a member object / an
  // assignment target / a shorthand property value?" in O(1) without re-walking.
  annotateParents(m) {
    walk(m.ast, (node, parent, key) => {
      node.$p = parent;
      node.$k = key;
    });
  }

  attrsOf(node) {
    const out = {};
    for (const a of node.attributes || []) out[a.key.name || a.key.value] = a.value.value;
    return out;
  }

  collectModuleRecords(m) {
    const scope = m.info.moduleScope;
    for (const st of m.ast.body) {
      switch (st.type) {
        case 'ImportDeclaration': {
          const dep = this.load(this.resolve(st.source.value, m.id), null, this.attrsOf(st));
          m.deps.push({ module: dep, node: st });
          for (const s of st.specifiers) {
            const b = scope.vars.get(s.local.name);
            b.importFrom = dep;
            b.importName = s.type === 'ImportNamespaceSpecifier' ? '*' : s.type === 'ImportDefaultSpecifier'
              ? 'default' : (s.imported.name ?? s.imported.value);
          }
          break;
        }
        case 'ExportNamedDeclaration':
          if (st.declaration) {
            const d = st.declaration;
            const ids = d.type === 'VariableDeclaration' ? d.declarations.flatMap((x) => patternIds(x.id)) : [d.id];
            for (const id of ids) m.localExports.set(id.name, scope.vars.get(id.name));
          } else if (st.source) {
            const dep = this.load(this.resolve(st.source.value, m.id), null, this.attrsOf(st));
            m.deps.push({ module: dep, node: st });
            for (const s of st.specifiers) {
              const exported = s.exported.name ?? s.exported.value;
              m.reexports.set(exported, { module: dep, name: s.local.name ?? s.local.value });
            }
          } else {
            for (const s of st.specifiers) {
              const exported = s.exported.name ?? s.exported.value;
              const b = scope.vars.get(s.local.name);
              if (!b) throw new BundleError(`${m.id}: exported "${s.local.name}" is not declared`);
              m.localExports.set(exported, b);
            }
          }
          break;
        case 'ExportDefaultDeclaration': {
          const d = st.declaration;
          if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) {
            m.localExports.set('default', scope.vars.get(d.id.name));
            // `export default x` of a local binding: alias the export to x itself ($aliasOnly) instead of a copy. Not
            // strictly the spec (default is a snapshot of x at that moment), but equivalent unless x is reassigned later.
          } else if (d.type === 'Identifier' && scope.vars.get(d.name)) {
            m.localExports.set('default', scope.vars.get(d.name));
            st.$aliasOnly = true;
          } else {
            const b = new Binding('default', 'const', scope);
            b.synthetic = true;
            b.decl = st;
            m.defaultBinding = b;
            m.localExports.set('default', b);
          }
          break;
        }
        case 'ExportAllDeclaration': {
          const dep = this.load(this.resolve(st.source.value, m.id), null, this.attrsOf(st));
          m.deps.push({ module: dep, node: st });
          if (st.exported) m.reexports.set(st.exported.name ?? st.exported.value, { module: dep, name: '*' });
          else m.stars.push(dep);
          break;
        }
      }
    }
    // new URL('./x', import.meta.url) is recognised only in this exact static shape with an unbound URL: anything
    // computed cannot be resolved at build time and stays as is (it would then point at the HTML page's URL).
    // Dynamic imports and import.meta assets.
    walk(m.ast, (node) => {
      if (node.type === 'ImportExpression') {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          const dep = this.load(this.resolve(node.source.value, m.id));
          m.dynamicDeps.push(dep);
          node.$dep = dep;
          if (!this.split) this.warn(`${m.id}: import("${node.source.value}") is bundled and evaluated eagerly`);
        } else {
          this.warn(`${m.id}: dynamic import() with a computed specifier is left as is`);
        }
      } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' &&
        !node.callee.$binding && node.arguments.length === 2 && node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string' && this.isImportMetaUrl(node.arguments[1])) {
        const file = this.resolve(node.arguments[0].value.startsWith('.') || node.arguments[0].value.startsWith('/')
          ? node.arguments[0].value : './' + node.arguments[0].value, m.id);
        const isBundle = /\?(?:[^#]*&)?bundle(?:[&=#]|$)/.test(node.arguments[0].value);
        if (!isBundle) this.assetDeps.add(file);
        if (this.split && !isBundle) (m.assets || (m.assets = [])).push({ file, arg: node.arguments[0] });
        else if (isBundle) {
          // `?bundle`: the module bundled for another host (see the header), gzip-compressed, as a data: URL (split
          // output: the argument becomes the data: URL, the base URL is then ignored).
          const ab = assetBundle(file, this.root, this.readFile);
          for (const f of ab.files) this.inputDeps = (this.inputDeps || new Set()).add(f);
          for (const w of ab.warnings) this.warn(w);
          const uri = 'data:application/gzip;base64,' + Buffer.from(ab.bytes).toString('base64');
          if (this.split) (m.assets || (m.assets = [])).push({ file, arg: node.arguments[0], uri });
          else m.edits.push({ start: node.start, end: node.end, text: `new URL(${JSON.stringify(uri)})` });
        } else m.edits.push({ start: node.start, end: node.end, text: `new URL(${JSON.stringify(dataURI(file, this.readFile(file)))})` });
        node.$inlined = true;
      } else if (!this.split && node.type === 'MetaProperty' && node.meta.name === 'import' && !(node.$p && node.$p.$p && node.$p.$p.$inlined)) {
        this.warn(`${m.id}: import.meta refers to the HTML document once inlined`);
      }
    });
  }

  isImportMetaUrl(n) {
    return n.type === 'MemberExpression' && !n.computed && n.property.name === 'url' &&
      n.object.type === 'MetaProperty' && n.object.meta.name === 'import';
  }

  // Resolves an export to { binding, module } or { ns: module }.
  // Follows local exports, named re-exports and `export *` chains to the declaring binding. `seen` breaks cycles of
  // re-exports. `default` is never forwarded by `export *` (spec rule).
  // KNOWN DEFECT: with two `export *` sources providing the same name, the first wins; the spec makes such a name
  // ambiguous (excluded from the namespace, an import of it is a SyntaxError). Fix: collect all matches and fail when
  // they resolve to different bindings.
  resolveExport(m, name, seen = new Set()) {
    const key = m.id + '\0' + name;
    if (seen.has(key)) return null;
    seen.add(key);
    if (name === '*') return { ns: m };
    const local = m.localExports.get(name);
    if (local) return this.resolveBinding(local, m, seen);
    const re = m.reexports.get(name);
    if (re) return this.resolveExport(re.module, re.name, seen);
    if (name !== 'default') {
      for (const s of m.stars) {
        const r = this.resolveExport(s, name, seen);
        if (r) return r;
      }
    }
    return null;
  }

  resolveBinding(b, m, seen = new Set()) {
    if (b.kind === 'import' && b.importFrom) {
      const r = this.resolveExport(b.importFrom, b.importName, seen);
      if (!r) throw new BundleError(`${m.id}: "${b.importFrom.id}" has no export named "${b.importName}"`);
      return r;
    }
    return { binding: b, module: m };
  }

  exportNames(m, seen = new Set()) {
    if (seen.has(m)) return new Set();
    seen.add(m);
    const names = new Set([...m.localExports.keys(), ...m.reexports.keys()]);
    for (const s of m.stars) for (const n of this.exportNames(s, seen)) if (n !== 'default') names.add(n);
    return names;
  }

  // ---- execution order -------------------------------------------------------------------------

  // Post-order DFS = ES evaluation order. `visiting` cuts cycles where the spec would too: the module that closes a
  // cycle runs before the one it imports from, and TDZ errors in such cycles behave the same as unbundled.
  sort(entryModules) {
    const done = new Set();
    const visiting = new Set();
    const visit = (m) => {
      if (done.has(m) || visiting.has(m)) return;
      visiting.add(m);
      for (const d of m.deps) visit(d.module);
      for (const d of m.dynamicDeps) visit(d);
      visiting.delete(m);
      done.add(m);
      this.order.push(m);
    };
    for (const m of entryModules) visit(m);
  }

  // ---- units -----------------------------------------------------------------------------------

  // Unit kinds: 'declarator' (one per declarator of a let/const/var statement, so `const a = 1, b = f()` can drop a
  // alone), 'decl' (function/class), 'default-decl' / 'default-expr', and 'stmt' (anything else at top level).
  // A pure declarator or statement that mutates module bindings records them in `attach`; buildUnits then attaches
  // the unit to each target binding so liveness keeps it exactly when a target is live.
  buildUnits(m) {
    if (m.kind === 'json') {
      m.units.push({ module: m, kind: 'json', declares: [m.jsonBinding], refs: new Set(), ns: [], pure: true, attach: [] });
      m.jsonBinding.units = [m.units[0]];
      return;
    }
    const fx = m.fx;
    const scope = m.info.moduleScope;
    const pureCtx = () => ({ root: scope, mutated: null });
    const mutCtx = () => ({ root: scope, mutated: new Set() });
    const add = (u) => {
      u.module = m;
      u.refs = new Set();
      u.ns = [];
      this.collectRefs(m, u.node, u);
      m.units.push(u);
      for (const b of u.declares) (b.units || (b.units = [])).push(u);
      return u;
    };
    for (const st of m.ast.body) {
      let node = st;
      if (st.type === 'ImportDeclaration' || st.type === 'ExportAllDeclaration') continue;
      if (st.type === 'ExportNamedDeclaration') {
        if (!st.declaration) continue;
        node = st.declaration;
      }
      if (st.type === 'ExportDefaultDeclaration') {
        if (st.$aliasOnly) continue;
        const d = st.declaration;
        if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
          const b = d.id ? scope.vars.get(d.id.name) : m.defaultBinding;
          add({ kind: 'default-decl', stmt: st, node: d, declares: [b],
            pure: d.type === 'FunctionDeclaration' || !fx.classImpure(d, pureCtx()), attach: [] });
        } else {
          add({ kind: 'default-expr', stmt: st, node: d, declares: [m.defaultBinding], pure: !fx.expr(d, pureCtx()), attach: [] });
        }
        continue;
      }
      if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          const declares = patternIds(d.id).map((id) => scope.vars.get(id.name));
          const ctx = mutCtx();
          const impure = (d.init && fx.expr(d.init, ctx)) || fx.pattern(d.id, ctx);
          add({ kind: 'declarator', stmt: st, decl: node, node: d, declares, pure: !impure,
            attach: impure ? [] : [...ctx.mutated].filter((b) => !declares.includes(b)) });
        }
        continue;
      }
      if (node.type === 'FunctionDeclaration') {
        add({ kind: 'decl', stmt: st, node, declares: [scope.vars.get(node.id.name)], pure: true, attach: [] });
        continue;
      }
      if (node.type === 'ClassDeclaration') {
        add({ kind: 'decl', stmt: st, node, declares: [scope.vars.get(node.id.name)], pure: !fx.classImpure(node, pureCtx()),
          attach: [] });
        continue;
      }
      // `var` declared inside such a statement (for (var i...)) is hoisted to module scope and counted as declared
      // by this unit, so a reference to it keeps the whole statement.
      // Other statements: pure (dead), mutation-only (kept with the mutated bindings) or impure (kept).
      const ctx = mutCtx();
      const impure = fx.stmt(node, ctx);
      const declaresVar = [];
      this.hoistedVars(node, declaresVar);
      const declares = declaresVar.map((id) => scope.vars.get(id.name));
      add({ kind: 'stmt', stmt: st, node, declares, pure: !impure,
        attach: impure ? [] : [...ctx.mutated].filter((b) => !declares.includes(b)) });
    }
    for (const u of m.units) {
      for (const b of u.attach) {
        const target = this.attachTarget(b, m);
        if (target) (target.attached || (target.attached = [])).push(u);
      }
    }
  }

  attachTarget(b, m) {
    if (b.kind === 'import') {
      const r = this.resolveBinding(b, m);
      return r.binding || null;
    }
    return b;
  }

  hoistedVars(node, out) {
    walk(node, (n) => {
      if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration' ||
        n.type === 'ClassExpression' || n.type === 'ClassDeclaration') return false;
      if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) out.push(...patternIds(d.id));
    });
  }

  // Module-level bindings referenced inside `node`; static namespace member accesses are recorded apart.
  // A namespace import used only as `ns.name` (read, static key) is recorded as a member access, not a reference to
  // the namespace: then only `name` becomes live and the namespace object is never materialised. Any other use
  // (passing ns around, ns[key], writes) references the whole namespace, which makes every export live.
  collectRefs(m, node, u) {
    const scope = m.info.moduleScope;
    walk(node, (n) => {
      if (n.type !== 'Identifier' || n.$role !== 'ref' || !n.$binding || n.$binding.scope !== scope) return;
      const b = n.$binding;
      if (b.kind === 'import' && this.resolveBinding(b, m).ns) {
        const p = n.$p;
        if (p && p.type === 'MemberExpression' && n.$k === 'object' && !n.$write &&
          (!p.computed || (p.property.type === 'Literal' && typeof p.property.value === 'string')) &&
          !(p.$p && ((p.$p.type === 'AssignmentExpression' && p.$k === 'left') || p.$p.type === 'UpdateExpression' ||
            (p.$p.type === 'UnaryExpression' && p.$p.operator === 'delete')))) {
          const prop = p.computed ? p.property.value : p.property.name;
          u.ns.push({ binding: b, prop, member: p, id: n });
          return;
        }
      }
      u.refs.add(b);
    });
  }

  // ---- liveness --------------------------------------------------------------------------------

  markUnit(u) {
    if (u.live) return;
    u.live = true;
    this.queue.push(u);
  }

  markBinding(b, m) {
    if (b.kind === 'import' && b.importFrom) {
      const r = this.resolveBinding(b, m);
      if (r.ns) this.markNamespace(r.ns);
      else this.markBinding(r.binding, r.module);
      return;
    }
    if (b.live) return;
    b.live = true;
    for (const u of b.units || []) this.markUnit(u);
    for (const u of b.attached || []) this.markUnit(u);
  }

  markNamespace(m) {
    if (m.nsNeeded) return;
    m.nsNeeded = true;
    for (const name of this.exportNames(m)) this.markExport(m, name);
  }

  markExport(m, name) {
    const r = this.resolveExport(m, name);
    if (!r) throw new BundleError(`${m.id}: no export named "${name}"`);
    if (r.ns) this.markNamespace(r.ns);
    else this.markBinding(r.binding, r.module);
  }

  // Worklist (LIFO) instead of recursion: deep dependency chains cannot overflow the stack. Each unit and binding
  // is marked once, so the pass is linear in total references.
  liveness() {
    this.queue = [];
    for (const m of this.order) {
      for (const u of m.units) if (!u.pure) this.markUnit(u);
      for (const d of m.dynamicDeps) this.markNamespace(d);
    }
    while (this.queue.length) {
      const u = this.queue.pop();
      for (const b of u.refs) this.markBinding(b, u.module);
      for (const n of u.ns) {
        const er = this.nsMemberTarget(n, u.module);
        if (er.ns) this.markNamespace(er.ns);
        else this.markBinding(er.binding, er.module);
      }
    }
  }

  nsMemberTarget(n, m) {
    const target = this.resolveBinding(n.binding, m).ns;
    const er = this.resolveExport(target, n.prop);
    if (!er) throw new BundleError(`${m.id}: "${target.id}" has no export named "${n.prop}"`);
    return er;
  }

  // ---- naming ----------------------------------------------------------------------------------

  // Bindings that appear in the output: declared by a live unit.
  emittedBindings(m) {
    const out = new Set();
    for (const u of m.units) if (u.live) for (const b of u.declares) if (b) out.add(b);
    return out;
  }

  // Names reserved up front: every global any module reads (renaming a binding to `document` would capture it) and
  // the globals the synthesized code itself uses. `allNames` (every identifier anywhere) is avoided by fresh names,
  // so a generated `x$1` can never collide with an inner local spelled the same. Modules are processed in execution
  // order, so earlier (deeper) modules keep their original names, which keeps the output readable.
  assignNames() {
    const allNames = new Set();
    const used = new Set(['Object', 'Symbol', 'Promise', 'JSON', 'URL']); // globals synthesized code relies on
    for (const m of this.order) {
      if (m.kind !== 'js') continue;
      for (const n of m.info.names) allNames.add(n);
      for (const n of m.info.globals.keys()) used.add(n);
    }
    const fresh = (base) => {
      const clean = base.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^(?=[0-9])/, '_') || '_';
      if (!used.has(clean) && !allNames.has(clean)) return clean;
      for (let i = 1; ; i++) {
        const c = `${clean}$${i}`;
        if (!used.has(c) && !allNames.has(c)) return c;
      }
    };
    // Would `name` be captured by an inner declaration at some reference in another module?
    // An importer's reference `foo` will be rewritten to the binding's final name; if some scope between that
    // reference and its module scope declares that final name, the rewrite would bind to the inner variable instead.
    const sitesOk = (b, name) => {
      for (const site of b.importSites || []) {
        if (site.$scope.declaresBefore(name, this.moduleScopeOf(site))) return false;
      }
      return true;
    };
    for (const m of this.order) {
      const base = path.basename(m.id).replace(/[#.].*$/, '') || 'm';
      if (m.kind === 'json') {
        if (m.jsonBinding.live) used.add(m.jsonBinding.final = fresh(base + '_json'));
      } else {
        for (const b of this.emittedBindings(m)) {
          if (b.synthetic) {
            used.add(b.final = fresh(base + '_default'));
            continue;
          }
          let name = b.name;
          if (used.has(name) || !sitesOk(b, name)) name = fresh(b.name);
          used.add(b.final = name);
        }
      }
      if (m.nsNeeded) used.add(m.nsName = fresh(base + '_ns'));
    }
  }

  moduleScopeOf(id) {
    let s = id.$scope;
    while (s.parent) s = s.parent;
    return s;
  }

  // For every local binding: the identifiers in importing modules that will be renamed to its final name.
  collectImportSites() {
    const add = (t, id) => (t.importSites || (t.importSites = [])).push(id);
    for (const m of this.order) {
      if (m.kind !== 'js') continue;
      for (const b of m.info.moduleScope.vars.values()) {
        if (b.kind !== 'import') continue;
        const r = this.resolveBinding(b, m);
        if (r.binding) for (const id of b.refs) add(r.binding, id);
      }
      for (const u of m.units) {
        for (const n of u.ns) {
          const er = this.nsMemberTarget(n, m);
          if (er.binding) add(er.binding, n.id);
        }
      }
    }
  }

  // ---- emission --------------------------------------------------------------------------------

  finalNameOf(b, m) {
    if (b.kind === 'import' && b.importFrom) {
      const r = this.resolveBinding(b, m);
      if (r.ns) return r.ns.nsName;
      return r.binding.final;
    }
    return b.final;
  }

  exportFinal(m, name) {
    const r = this.resolveExport(m, name);
    return r.ns ? r.ns.nsName : r.binding.final;
  }

  // Shorthand properties need expansion when renamed: `{ foo }` must become `{ foo: foo$1 }` (the key is part of the
  // object's shape), likewise shorthand patterns with defaults `{ foo = 1 }`. import() of a bundled module becomes
  // Promise.resolve(namespace): same async shape, module already evaluated (eagerly).
  buildEdits(m) {
    const scope = m.info.moduleScope;
    const edits = m.edits;
    const nsMembers = new Set();
    for (const u of m.units) {
      if (!u.live) continue;
      for (const n of u.ns) {
        const er = this.nsMemberTarget(n, m);
        edits.push({ start: n.member.start, end: n.member.end, text: er.ns ? er.ns.nsName : er.binding.final });
        nsMembers.add(n.id);
      }
    }
    walk(m.ast, (n) => {
      if (n.type === 'ImportExpression' && n.$dep) {
        edits.push({ start: n.start, end: n.end, text: `Promise.resolve(${n.$dep.nsName})` });
        return false;
      }
      if (n.type !== 'Identifier' || !n.$binding || n.$binding.scope !== scope || nsMembers.has(n)) return;
      if (n.$role !== 'ref' && n.$role !== 'decl') return;
      const b = n.$binding;
      const final = b.kind === 'import' ? this.finalNameOf(b, m) : b.final;
      if (final === undefined || final === n.name) return;
      const p = n.$p;
      if (p && p.type === 'Property' && p.shorthand && n.$k === 'value') {
        edits.push({ start: n.start, end: n.end, text: `${n.name}: ${final}` });
      } else if (p && p.type === 'AssignmentPattern' && n.$k === 'left' && p.$p && p.$p.type === 'Property' &&
        p.$p.shorthand) {
        edits.push({ start: n.start, end: n.end, text: `${n.name}: ${final}` });
      } else {
        edits.push({ start: n.start, end: n.end, text: final });
      }
    });
    // Nested edits (an identifier inside an inlined new URL(...)) are dropped in favour of the outer one.
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const flat = [];
    let lastEnd = -1;
    for (const e of edits) {
      if (e.start < lastEnd) continue;
      flat.push(e);
      lastEnd = Math.max(lastEnd, e.end);
    }
    m.edits = flat;
  }

  // Binary search for the first edit in range, then a linear splice: O(log E + edits in range) per unit.
  slice(m, start, end) {
    const { edits, src } = m;
    let lo = 0, hi = edits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (edits[mid].start < start) lo = mid + 1; else hi = mid;
    }
    let out = '';
    let pos = start;
    for (let i = lo; i < edits.length && edits[i].start < end; i++) {
      const e = edits[i];
      out += src.slice(pos, e.start) + e.text;
      pos = e.end;
    }
    return out + src.slice(pos, end);
  }

  // JSON is re-emitted through JSON.parse of a string literal: engines parse JSON text faster than an equivalent
  // object literal, and the value is validated once more at build time. A partially live declaration is rebuilt from
  // its live declarators with the original kind (const/let/var), dropping only the dead ones.
  // The namespace object mirrors the spec's module namespace exotic object: null prototype, Symbol.toStringTag
  // 'Module', frozen, and getters (live bindings: a later reassignment of an export is visible through it).
  emitModule(m) {
    const parts = [];
    if (m.kind === 'json') {
      if (m.jsonBinding.live) parts.push(`const ${m.jsonBinding.final} = JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(m.src)))});`);
    } else {
      let i = 0;
      const units = m.units;
      while (i < units.length) {
        const u = units[i];
        if (u.kind === 'declarator') {
          // Group the declarators of one declaration statement.
          const group = [];
          while (i < units.length && units[i].decl === u.decl) group.push(units[i++]);
          const live = group.filter((x) => x.live);
          if (!live.length) continue;
          if (live.length === group.length) parts.push(this.terminate(this.slice(m, u.decl.start, u.decl.end), u.decl));
          else parts.push(`${u.decl.kind} ${live.map((x) => this.slice(m, x.node.start, x.node.end)).join(', ')};`);
          continue;
        }
        i++;
        if (!u.live) continue;
        if (u.kind === 'default-expr') {
          parts.push(`const ${m.defaultBinding.final} = ${this.slice(m, u.node.start, u.node.end)};`);
        } else if (u.kind === 'default-decl' && !u.node.id) {
          const text = this.slice(m, u.node.start, u.node.end);
          const re = u.node.type === 'ClassDeclaration' ? /^class\b/ : /^(async\s+)?function\b\s*(\*)?/;
          parts.push(text.replace(re, (k) => `${k} ${m.defaultBinding.final}`));
        } else {
          parts.push(this.terminate(this.slice(m, u.node.start, u.node.end), u.node));
        }
      }
    }
    if (m.nsNeeded) {
      const names = [...this.exportNames(m)].sort();
      const props = names.map((n) => `get ${JSON.stringify(n)}() { return ${this.exportFinal(m, n)}; }`);
      parts.push(`const ${m.nsName} = Object.freeze({ __proto__: null, [Symbol.toStringTag]: 'Module', ${props.join(', ')} });`);
    }
    return parts;
  }

  // A statement without its own ';' must not run into the next emitted one (`(`, `[`, template, ...).
  // ASI hazard: concatenating `a = b` and `(f)()` would parse as `a = b(f)()`. An explicit ';' after every emitted
  // non-declaration statement removes the hazard; function/class declarations need none.
  terminate(text, node) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return text;
    return /;\s*$/.test(text) ? text : text + ';';
  }

  // Licence comments are hoisted to the top of the bundle, deduplicated: they must survive tree-shaking even when the
  // unit they sat next to was dropped.
  licenses() {
    const out = [];
    for (const m of this.order) {
      if (m.kind !== 'js') continue;
      for (const c of m.ast.comments) {
        if (c.type === 'Block' && (c.value.startsWith('!') || /@(license|preserve)\b/.test(c.value))) {
          out.push(`/*${c.value}*/`);
        }
      }
    }
    return [...new Set(out)];
  }

  run() {
    const entryModules = this.entries.map((e) => this.load(e.file, e.code ?? null));
    this.sort(entryModules);
    this.fnStack = [];
    for (const m of this.order) if (m.kind === 'js') m.fx = new Effects(m, this);
    for (const m of this.order) this.buildUnits(m);
    this.liveness();
    this.collectImportSites();
    this.assignNames();
    const chunks = [];
    let unitsTotal = 0, unitsLive = 0;
    for (const m of this.order) {
      unitsTotal += m.units.length;
      unitsLive += m.units.filter((u) => u.live).length;
      if (m.kind === 'js') this.buildEdits(m);
      const parts = this.emitModule(m);
      if (parts.length) chunks.push(parts.join('\n'));
    }
    const code = [...this.licenses(), ...chunks].join('\n');
    return {
      code,
      warnings: this.warnings,
      files: [...this.modules.keys()].filter((id) => !/#\d+$/.test(id)).concat([...this.assetDeps], [...(this.inputDeps || [])]),
      stats: { modules: this.order.length, units: unitsTotal, live: unitsLive },
    };
  }

  // ---- split output ----------------------------------------------------------------------------

  // Split mode reuses phases 1-4 (graph, units, liveness) but emits one file per module with real import/export
  // statements instead of renaming into one scope. Imports are re-targeted to the module that DECLARES each binding,
  // so re-export barrels (index.js files) vanish from the output unless a namespace object needs them. Only names
  // some other module actually imports are exported: dead exports disappear too.
  runSplit(outPath) {
    const entryModules = this.entries.map((e) => this.load(e.file, e.code ?? null));
    this.sort(entryModules);
    this.fnStack = [];
    for (const m of this.order) if (m.kind === 'js') m.fx = new Effects(m, this);
    for (const m of this.order) this.buildUnits(m);
    this.liveness();
    const entries = new Set(entryModules);
    const emitted = (m) => (m.$emit ??= entries.has(m) || m.nsNeeded || m.units.some((u) => u.live));
    const outOf = (m) => (m.$out ??= m.kind === 'json' ? outPath(m.id) + '.js' : outPath(m.id.replace(/#\d+$/, '')));
    const spec = (from, to) => {
      let r = path.posix.relative(path.posix.dirname(outOf(from)), to);
      if (!r.startsWith('.')) r = './' + r;
      return r;
    };
    const exportsOf = new Map(); // module -> Set of local names other modules import
    const needExport = (m, name) => {
      let set = exportsOf.get(m);
      if (!set) exportsOf.set(m, set = new Set());
      set.add(name);
    };
    const localName = (b, m) => (m.kind === 'json' ? 'default' : b.synthetic ? this.defaultName(m) : b.name);
    const plans = new Map();
    for (const m of this.order) {
      if (!emitted(m) || m.kind !== 'js') continue;
      const imports = new Map(); // target module -> { named: Map(alias -> local), ns: Set(alias) }
      const want = (t) => {
        let e = imports.get(t);
        if (!e) imports.set(t, e = { named: new Map(), ns: new Set() });
        return e;
      };
      const edits = [];
      const aliases = new Map();
      const addBinding = (b) => {
        const r = this.resolveBinding(b, m);
        if (r.ns) { want(r.ns).ns.add(b.name); return; }
        const local = localName(r.binding, r.module);
        want(r.module).named.set(b.name, local);
        needExport(r.module, local);
      };
      for (const u of m.units) {
        if (!u.live) continue;
        for (const b of u.refs) if (b.kind === 'import' && b.importFrom) addBinding(b);
        for (const n of u.ns) {
          const er = this.nsMemberTarget(n, m);
          const key = n.binding.name + '.' + n.prop;
          let alias = aliases.get(key);
          if (!alias) {
            alias = this.freshName(m, (n.binding.name + '$' + n.prop).replace(/[^A-Za-z0-9_$]/g, '_'));
            aliases.set(key, alias);
            if (er.ns) want(er.ns).ns.add(alias);
            else {
              const local = localName(er.binding, er.module);
              want(er.module).named.set(alias, local);
              needExport(er.module, local);
            }
          }
          edits.push({ start: n.member.start, end: n.member.end, text: alias });
        }
      }
      walk(m.ast, (n) => {
        if (n.type === 'ImportExpression' && n.$dep && emitted(n.$dep)) {
          edits.push({ start: n.source.start, end: n.source.end, text: JSON.stringify(spec(m, outOf(n.$dep))) });
        }
      });
      for (const a of m.assets || []) edits.push({ start: a.arg.start, end: a.arg.end, text: JSON.stringify(a.uri || spec(m, outPath(a.file))) });
      plans.set(m, { imports, edits });
    }
    // Namespace objects (import * as with dynamic uses, import()): the module exports everything it exports.
    for (const m of this.order) {
      if (!emitted(m) || !m.nsNeeded || m.kind !== 'js') continue;
      m.$nsExports = [];
      for (const name of [...this.exportNames(m)].sort()) {
        const r = this.resolveExport(m, name);
        if (!r) continue;
        if (r.ns) { m.$nsExports.push({ name, ns: r.ns }); continue; }
        const local = localName(r.binding, r.module);
        if (r.module !== m) needExport(r.module, local);
        m.$nsExports.push({ name, module: r.module, local });
      }
    }
    // Import order: the original dependency order, looking through modules that are not emitted.
    // Side-effect import order must be preserved: when a dep is not emitted (fully dead), look through it to its own
    // deps, so `import './a.js'` that only existed for a's imports still triggers them in the original order.
    const targetsOf = (d, seen) => {
      if (seen.has(d)) return [];
      seen.add(d);
      if (emitted(d)) return [d];
      return d.deps.flatMap((x) => targetsOf(x.module, seen));
    };
    const as = (local, name) => (local === name ? name : `${local} as ${name}`);
    const modules = [];
    let unitsTotal = 0, unitsLive = 0;
    for (const m of this.order) {
      unitsTotal += m.units.length;
      unitsLive += m.units.filter((u) => u.live).length;
      if (!emitted(m)) continue;
      const parts = [];
      if (m.kind === 'json') {
        parts.push(`export default JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(m.src)))});`);
      } else {
        const { imports, edits } = plans.get(m);
        const order = [];
        const seen = new Set([m]);
        for (const d of m.deps) for (const t of targetsOf(d.module, seen)) if (!order.includes(t)) order.push(t);
        for (const t of imports.keys()) if (!order.includes(t)) order.push(t);
        for (const t of order) {
          const p = JSON.stringify(spec(m, outOf(t)));
          const e = imports.get(t);
          const named = e ? [...e.named].map(([alias, local]) => as(local, alias)) : [];
          const ns = e ? [...e.ns] : [];
          if (named.length) parts.push(`import { ${named.join(', ')} } from ${p};`);
          for (const a of ns) parts.push(`import * as ${a} from ${p};`);
          if (!named.length && !ns.length) parts.push(`import ${p};`);
        }
        edits.sort((a, b) => a.start - b.start || b.end - a.end);
        m.edits = edits.filter((e, i) => !i || e.start >= edits[i - 1].end);
        parts.push(...this.emitSplitUnits(m));
      }
      // Exports: what other modules import, plus the whole namespace when one is needed.
      const ex = new Map();
      if (m.kind !== 'json') for (const local of exportsOf.get(m) || []) ex.set(local, local);
      const reex = [];
      for (const e of m.$nsExports || []) {
        if (e.ns) reex.push(`export * as ${e.name} from ${JSON.stringify(spec(m, outOf(e.ns)))};`);
        else if (e.module === m) ex.set(e.name, as(e.local, e.name));
        else reex.push(`export { ${as(e.local, e.name)} } from ${JSON.stringify(spec(m, outOf(e.module)))};`);
      }
      if (ex.size) parts.push(`export { ${[...ex.values()].join(', ')} };`);
      parts.push(...reex);
      const inline = /#\d+$/.test(m.id);
      modules.push({ id: m.id, out: inline ? null : outOf(m), inline, code: parts.join('\n') });
    }
    const assets = [...this.assetDeps].map((file) => ({ file, out: outPath(file) }));
    return {
      modules, assets, warnings: this.warnings,
      files: [...this.modules.keys()].filter((id) => !/#\d+$/.test(id)).concat([...this.assetDeps], [...(this.inputDeps || [])]),
      stats: { modules: modules.length, units: unitsTotal, live: unitsLive },
    };
  }

  // A module-level name that does not occur in the module (aliases of namespace members, default exports).
  // Aliases avoid every name present in the module (declared or global) and every alias handed out before.
  freshName(m, base) {
    const taken = (n) => m.info.names.has(n) || m.info.globals.has(n) || (m.$fresh && m.$fresh.has(n));
    let name = base;
    for (let i = 1; taken(name); i++) name = `${base}$${i}`;
    (m.$fresh || (m.$fresh = new Set())).add(name);
    return name;
  }

  defaultName(m) {
    return (m.$defaultName ??= this.freshName(m, '__default'));
  }

  // Live units of a module under their own names (split output); the same grouping as emitModule.
  emitSplitUnits(m) {
    const parts = [];
    const units = m.units;
    let i = 0;
    while (i < units.length) {
      const u = units[i];
      if (u.kind === 'declarator') {
        const group = [];
        while (i < units.length && units[i].decl === u.decl) group.push(units[i++]);
        const live = group.filter((x) => x.live);
        if (!live.length) continue;
        if (live.length === group.length) parts.push(this.terminate(this.slice(m, u.decl.start, u.decl.end), u.decl));
        else parts.push(`${u.decl.kind} ${live.map((x) => this.slice(m, x.node.start, x.node.end)).join(', ')};`);
        continue;
      }
      i++;
      if (!u.live) continue;
      if (u.kind === 'default-expr') {
        parts.push(`const ${this.defaultName(m)} = ${this.slice(m, u.node.start, u.node.end)};`);
      } else if (u.kind === 'default-decl' && !u.node.id) {
        const text = this.slice(m, u.node.start, u.node.end);
        const re = u.node.type === 'ClassDeclaration' ? /^class\b/ : /^(async\s+)?function\b\s*(\*)?/;
        parts.push(text.replace(re, (k) => `${k} ${this.defaultName(m)}`));
      } else {
        parts.push(this.terminate(this.slice(m, u.node.start, u.node.end), u.node));
      }
    }
    return parts;
  }
}
