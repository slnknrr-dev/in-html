// scope.js - scope analysis for ESTree programs produced by parse.js (strict / module semantics).
//
//   import { analyze } from './scope.js';
//   const info = analyze(ast);
//   info.moduleScope.vars   Map<name, Binding> of top-level bindings (imports included)
//   info.globals            Map<name, Identifier[]> of unresolved (global) references
//   info.names              Set of every identifier name that occurs in the program
//
// Every Identifier that names a variable gets annotated in place:
//   id.$role    'decl' (declares a binding) | 'ref' (reads or writes one)
//   id.$binding the Binding (null for globals)
//   id.$scope   the Scope the identifier occurs in
//   id.$write   true for assignment targets and ++/-- operands
// Property keys, member properties, labels, meta properties and import/export names are not variables
// and stay unannotated. Class and function declarations bind their name in the enclosing scope only
// (inner self-references resolve to that same binding).
//
// Role in the build: bundle.js needs two facts this module provides. (1) Which top-level bindings a module's code
// actually references (tree-shaking walks binding -> refs). (2) Every name in use and every free (global) name, so
// that renaming colliding top-level bindings across concatenated modules never captures an inner local or shadows a
// global the code relies on.
// Approach: two passes per scope, mirroring the language: hoist (declare everything a scope introduces, since JS
// bindings are visible before their textual declaration), then walk (resolve every reference with lookup()). A
// single pass would resolve `f()` before `function f` to a global.
// Deliberate simplifications (sound for strict ES modules, the only input): no sloppy-mode Annex B function hoisting,
// no separate parameter scope (params and body share one function scope), and `with` is walked but cannot be
// resolved statically (names inside it are reported as ordinary refs; a consumer renaming them would be unsafe, and
// `with` is a SyntaxError in modules anyway).
// Annotations are written onto AST nodes ($role, $binding, $scope, $own) instead of side tables: consumers already
// hold the nodes, and lookups stay O(1) without Map overhead.

export class Scope {
  constructor(kind, parent, node) {
    this.kind = kind;                 // 'module' | 'function' | 'block' | 'class' | 'catch'
    this.parent = parent;
    this.node = node;
    this.vars = new Map();
    // `var` ignores blocks: it lands in the nearest function/module scope; cached so hoisting is O(1) per declarator.
    // Class scopes and static blocks inherit or define it correctly: a static block is created as 'function'.
    this.varScope = kind === 'module' || kind === 'function' ? this : parent.varScope;
  }

  lookup(name) {
    for (let s = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return null;
  }

  // Is `name` declared in this scope or any scope up to (excluding) `stop`?
  // Used by renaming: would introducing `name` here be shadowed by (or shadow) a declaration between this scope and
  // `stop`? Answering this per reference is what makes collision-free renaming possible.
  declaresBefore(name, stop) {
    for (let s = this; s && s !== stop; s = s.parent) if (s.vars.has(name)) return true;
    return false;
  }
}

export class Binding {
  constructor(name, kind, scope) {
    this.name = name;
    this.kind = kind;                 // 'var' | 'let' | 'const' | 'function' | 'class' | 'param' | 'catch' | 'import' | 'self'
    this.scope = scope;
    this.ids = [];                    // declaring identifiers
    this.refs = [];                   // referencing identifiers
    this.decl = null;                 // declaring node (VariableDeclarator, FunctionDeclaration, ImportSpecifier, ...)
    this.writes = 0;
  }
}

// Collects the binding identifiers of a pattern.
export function patternIds(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p); break;
    case 'ObjectPattern':
      for (const prop of p.properties) patternIds(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern': for (const e of p.elements) patternIds(e, out); break;
    case 'RestElement': patternIds(p.argument, out); break;
    case 'AssignmentPattern': patternIds(p.left, out); break;
  }
  return out;
}

class Analyzer {
  constructor() {
    this.globals = new Map();
    this.names = new Set();
    this.scopes = [];
  }

  newScope(kind, parent, node) {
    const s = new Scope(kind, parent, node);
    this.scopes.push(s);
    node.$own = s;
    return s;
  }

  // Redeclaration (var x; var x; or function + var) reuses the first Binding and appends the id: all spellings of one
  // variable must be renamed together. The first declaration's kind and decl win.
  declare(scope, id, kind, decl) {
    this.names.add(id.name);
    let b = scope.vars.get(id.name);
    if (!b) {
      b = new Binding(id.name, kind, scope);
      b.decl = decl;
      scope.vars.set(id.name, b);
    }
    b.ids.push(id);
    id.$role = 'decl';
    id.$binding = b;
    id.$scope = scope;
    return b;
  }

  // Unresolved names are collected as globals with every occurrence: the bundler must never rename a top-level
  // binding TO a name some module reads as a global (that would capture e.g. `document` or `fetch`).
  ref(scope, id, write = false) {
    this.names.add(id.name);
    const b = scope.lookup(id.name);
    id.$role = 'ref';
    id.$binding = b;
    id.$scope = scope;
    if (write) id.$write = true;
    if (b) {
      b.refs.push(id);
      if (write) b.writes++;
    } else {
      let list = this.globals.get(id.name);
      if (!list) this.globals.set(id.name, list = []);
      list.push(id);
    }
  }

  // ---- hoisting --------------------------------------------------------------------------------

  // Declares the bindings a statement list introduces into `scope` (lexical + functions) and hoists
  // `var` declarations (from nested blocks too) into scope.varScope.
  hoist(statements, scope) {
    for (const st of statements) this.hoistStatement(st, scope, true);
  }

  // `direct` = the statement sits directly in this scope's list. Lexical declarations (let/const/class/function)
  // bind only when direct; nested blocks get their own scope later. `var` binds into varScope regardless of depth.
  hoistStatement(st, scope, direct) {
    if (!st) return;
    switch (st.type) {
      case 'VariableDeclaration':
        if (st.kind === 'var') {
          for (const d of st.declarations) for (const id of patternIds(d.id)) this.declare(scope.varScope, id, 'var', d);
        } else if (direct) {
          for (const d of st.declarations) for (const id of patternIds(d.id)) this.declare(scope, id, st.kind, d);
        }
        break;
      case 'FunctionDeclaration':
        if (direct && st.id) this.declare(scope, st.id, 'function', st);
        break;
      case 'ClassDeclaration':
        if (direct && st.id) this.declare(scope, st.id, 'class', st);
        break;
      case 'ImportDeclaration':
        for (const s of st.specifiers) this.declare(scope, s.local, 'import', s);
        break;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (st.declaration && /Declaration$/.test(st.declaration.type)) this.hoistStatement(st.declaration, scope, direct);
        break;
      // Nested statements: only `var` declarations escape their blocks.
      case 'BlockStatement': for (const s of st.body) this.hoistStatement(s, scope, false); break;
      case 'IfStatement':
        this.hoistStatement(st.consequent, scope, false);
        this.hoistStatement(st.alternate, scope, false);
        break;
      case 'ForStatement':
        if (st.init && st.init.type === 'VariableDeclaration') this.hoistStatement(st.init, scope, false);
        this.hoistStatement(st.body, scope, false);
        break;
      case 'ForInStatement': case 'ForOfStatement':
        if (st.left.type === 'VariableDeclaration') this.hoistStatement(st.left, scope, false);
        this.hoistStatement(st.body, scope, false);
        break;
      case 'WhileStatement': case 'DoWhileStatement': case 'LabeledStatement': case 'WithStatement':
        this.hoistStatement(st.body, scope, false);
        break;
      case 'TryStatement':
        this.hoistStatement(st.block, scope, false);
        if (st.handler) this.hoistStatement(st.handler.body, scope, false);
        this.hoistStatement(st.finalizer, scope, false);
        break;
      case 'SwitchStatement':
        for (const c of st.cases) for (const s of c.consequent) this.hoistStatement(s, scope, false);
        break;
    }
  }

  // ---- statements ------------------------------------------------------------------------------

  program(ast) {
    const scope = this.newScope('module', null, ast);
    this.hoist(ast.body, scope);
    for (const st of ast.body) this.statement(st, scope);
    return scope;
  }

  statements(list, scope) {
    for (const st of list) this.statement(st, scope);
  }

  block(node, scope) {
    const s = this.newScope('block', scope, node);
    this.hoist(node.body, s);
    this.statements(node.body, s);
  }

  statement(st, scope) {
    if (!st) return;
    switch (st.type) {
      case 'VariableDeclaration':
        for (const d of st.declarations) {
          this.pattern(d.id, scope, true);
          if (d.init) this.expr(d.init, scope);
        }
        break;
      case 'FunctionDeclaration': this.func(st, scope); break;
      case 'ClassDeclaration': this.cls(st, scope); break;
      case 'ExpressionStatement': this.expr(st.expression, scope); break;
      case 'BlockStatement': this.block(st, scope); break;
      case 'EmptyStatement': case 'DebuggerStatement': break;
      case 'IfStatement':
        this.expr(st.test, scope);
        this.subStatement(st.consequent, scope);
        this.subStatement(st.alternate, scope);
        break;
      // The for-head gets its own block scope: `for (let i ...)` binds i per loop, invisible after it. (The per-iteration
      // copy semantics of let do not matter for name resolution.)
      case 'ForStatement': {
        const s = this.newScope('block', scope, st);
        if (st.init) {
          if (st.init.type === 'VariableDeclaration') {
            if (st.init.kind !== 'var') this.hoistStatement(st.init, s, true);
            this.statement(st.init, s);
          } else this.expr(st.init, s);
        }
        if (st.test) this.expr(st.test, s);
        if (st.update) this.expr(st.update, s);
        this.subStatement(st.body, s);
        break;
      }
      case 'ForInStatement': case 'ForOfStatement': {
        const s = this.newScope('block', scope, st);
        if (st.left.type === 'VariableDeclaration') {
          if (st.left.kind !== 'var') this.hoistStatement(st.left, s, true);
          for (const d of st.left.declarations) this.pattern(d.id, s, true);
        } else this.pattern(st.left, s, false);
        this.expr(st.right, s);
        this.subStatement(st.body, s);
        break;
      }
      case 'WhileStatement':
        this.expr(st.test, scope);
        this.subStatement(st.body, scope);
        break;
      case 'DoWhileStatement':
        this.subStatement(st.body, scope);
        this.expr(st.test, scope);
        break;
      case 'ReturnStatement': case 'ThrowStatement':
        if (st.argument) this.expr(st.argument, scope);
        break;
      case 'BreakStatement': case 'ContinueStatement': break;
      case 'LabeledStatement': this.subStatement(st.body, scope); break;
      case 'WithStatement':
        this.expr(st.object, scope);
        this.subStatement(st.body, scope);
        break;
      case 'TryStatement':
        this.block(st.block, scope);
        if (st.handler) {
          const s = this.newScope('catch', scope, st.handler);
          if (st.handler.param) {
            for (const id of patternIds(st.handler.param)) this.declare(s, id, 'catch', st.handler);
            this.pattern(st.handler.param, s, true);
          }
          this.block(st.handler.body, s);
        }
        if (st.finalizer) this.block(st.finalizer, scope);
        break;
        // All case clauses share ONE block scope (the switch body), as in the spec: `case 1: let x; case 2: x` is the same x.
      case 'SwitchStatement': {
        this.expr(st.discriminant, scope);
        const s = this.newScope('block', scope, st);
        for (const c of st.cases) this.hoist(c.consequent, s);
        for (const c of st.cases) {
          if (c.test) this.expr(c.test, s);
          this.statements(c.consequent, s);
        }
        break;
      }
      case 'ImportDeclaration': break;
      case 'ExportNamedDeclaration':
        if (st.declaration) this.statement(st.declaration, scope);
        else if (!st.source) {
          for (const sp of st.specifiers) if (sp.local.type === 'Identifier') this.ref(scope, sp.local);
        }
        break;
      case 'ExportDefaultDeclaration': {
        const d = st.declaration;
        if (d.type === 'FunctionDeclaration') this.func(d, scope);
        else if (d.type === 'ClassDeclaration') this.cls(d, scope);
        else this.expr(d, scope);
        break;
      }
      case 'ExportAllDeclaration': break;
      default:
        throw new Error('scope: unknown statement ' + st.type);
    }
  }

  // A statement in a position where a declaration would get its own scope (if/loop bodies).
  // A declaration as the direct body of if/loop gets a private block scope, so it cannot leak a binding into the
  // surrounding list (a function declaration as an if-body is legal only in sloppy Annex B; here it simply stays local).
  subStatement(st, scope) {
    if (!st) return;
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') {
      const s = this.newScope('block', scope, st);
      this.hoistStatement(st, s, true);
      this.statement(st, s);
    } else this.statement(st, scope);
  }

  // ---- functions and classes -------------------------------------------------------------------

  // A named function EXPRESSION binds its own name inside itself ('self'), invisible outside: `const f = function g(){}`
  // leaves g unbound at the call site. Params are declared before walking defaults, so `(a, b = a)` resolves a.
  func(fn, scope) {
    const s = this.newScope('function', scope, fn);
    if (fn.type === 'FunctionExpression' && fn.id) this.declare(s, fn.id, 'self', fn);
    for (const p of fn.params) for (const id of patternIds(p)) this.declare(s, id, 'param', fn);
    for (const p of fn.params) this.pattern(p, s, true);
    if (fn.body.type === 'BlockStatement') {
      this.hoist(fn.body.body, s);
      this.statements(fn.body.body, s);
    } else this.expr(fn.body, s);
  }

  // superClass is evaluated in the OUTER scope (before the class binding exists). Field initialisers and static
  // blocks get a 'function' scope: they have their own `this`/arguments semantics and `var` inside static blocks must
  // not escape to the enclosing function.
  cls(node, scope) {
    if (node.superClass) this.expr(node.superClass, scope);
    const s = this.newScope('class', scope, node);
    if (node.type === 'ClassExpression' && node.id) this.declare(s, node.id, 'self', node);
    for (const m of node.body.body) {
      if (m.type === 'StaticBlock') {
        const fs = this.newScope('function', s, m);
        this.hoist(m.body, fs);
        this.statements(m.body, fs);
        continue;
      }
      if (m.computed) this.expr(m.key, s);
      if (m.type === 'MethodDefinition') this.func(m.value, s);
      else if (m.value) {
        const fs = this.newScope('function', s, m);
        this.expr(m.value, fs);
      }
    }
  }

  // ---- patterns and expressions ----------------------------------------------------------------

  // Binding patterns (`isBinding`) annotate declared identifiers; assignment patterns write references.
  // Binding identifiers were already declared during hoisting; here they are only annotated (lookup finds the binding
  // hoisting created). Non-binding patterns are assignment targets: identifiers become write refs, members are walked
  // as expressions (obj.x = ... reads obj).
  pattern(p, scope, isBinding) {
    if (!p) return;
    switch (p.type) {
      case 'Identifier':
        if (isBinding) {
          if (!p.$binding) {
            const b = scope.lookup(p.name);
            p.$role = 'decl';
            p.$binding = b;
            p.$scope = scope;
          }
        } else this.ref(scope, p, true);
        break;
      case 'ObjectPattern':
        for (const prop of p.properties) {
          if (prop.type === 'RestElement') this.pattern(prop.argument, scope, isBinding);
          else {
            if (prop.computed) this.expr(prop.key, scope);
            this.pattern(prop.value, scope, isBinding);
          }
        }
        break;
      case 'ArrayPattern': for (const e of p.elements) this.pattern(e, scope, isBinding); break;
      case 'RestElement': this.pattern(p.argument, scope, isBinding); break;
      case 'AssignmentPattern':
        this.pattern(p.left, scope, isBinding);
        this.expr(p.right, scope);
        break;
      case 'MemberExpression': this.expr(p, scope); break;
      default: throw new Error('scope: unknown pattern ' + p.type);
    }
  }

  expr(e, scope) {
    if (!e) return;
    switch (e.type) {
      case 'Identifier': this.ref(scope, e); break;
      case 'Literal': case 'ThisExpression': case 'Super': case 'MetaProperty': case 'PrivateIdentifier': break;
      case 'TemplateLiteral': for (const x of e.expressions) this.expr(x, scope); break;
      case 'TaggedTemplateExpression':
        this.expr(e.tag, scope);
        for (const x of e.quasi.expressions) this.expr(x, scope);
        break;
      case 'ArrayExpression': for (const x of e.elements) this.expr(x, scope); break;
      case 'ObjectExpression':
        for (const p of e.properties) {
          if (p.type === 'SpreadElement') this.expr(p.argument, scope);
          else {
            if (p.computed) this.expr(p.key, scope);
            if (p.value.type === 'FunctionExpression' && (p.method || p.kind !== 'init')) this.func(p.value, scope);
            else if (p.value.type === 'AssignmentPattern') this.pattern(p.value, scope, false);
            else this.expr(p.value, scope);
          }
        }
        break;
      case 'SpreadElement': case 'AwaitExpression': this.expr(e.argument, scope); break;
      case 'YieldExpression': if (e.argument) this.expr(e.argument, scope); break;
      case 'UnaryExpression': this.expr(e.argument, scope); break;
      case 'UpdateExpression':
        // ++x / x-- writes x: the write count lets consumers tell constants from mutated bindings.
        if (e.argument.type === 'Identifier') this.ref(scope, e.argument, true);
        else this.expr(e.argument, scope);
        break;
      case 'BinaryExpression': case 'LogicalExpression':
        this.expr(e.left, scope);
        this.expr(e.right, scope);
        break;
      case 'AssignmentExpression':
        if (e.left.type === 'Identifier') this.ref(scope, e.left, true);
        else this.pattern(e.left, scope, false);
        this.expr(e.right, scope);
        break;
      case 'ConditionalExpression':
        this.expr(e.test, scope);
        this.expr(e.consequent, scope);
        this.expr(e.alternate, scope);
        break;
      case 'SequenceExpression': for (const x of e.expressions) this.expr(x, scope); break;
      case 'MemberExpression':
        this.expr(e.object, scope);
        if (e.computed) this.expr(e.property, scope);
        break;
      case 'ChainExpression': this.expr(e.expression, scope); break;
      case 'CallExpression': case 'NewExpression':
        this.expr(e.callee, scope);
        for (const a of e.arguments) this.expr(a, scope);
        break;
      case 'FunctionExpression': case 'ArrowFunctionExpression': this.func(e, scope); break;
      case 'ClassExpression': this.cls(e, scope); break;
      case 'ImportExpression':
        this.expr(e.source, scope);
        if (e.options) this.expr(e.options, scope);
        break;
      case 'ObjectPattern': case 'ArrayPattern': case 'AssignmentPattern': case 'RestElement':
        this.pattern(e, scope, false);
        break;
      default:
        throw new Error('scope: unknown expression ' + e.type);
    }
  }
}

export function analyze(ast) {
  const a = new Analyzer();
  const moduleScope = a.program(ast);
  return { moduleScope, globals: a.globals, names: a.names, scopes: a.scopes };
}
