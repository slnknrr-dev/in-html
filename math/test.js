// math/test.js - unit tests of the math library: node math/test.js (also node check.js tests math).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { texToMathML, MATH_CSS } from './tex.js';
import { styled } from './symbols.js';

let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x math: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };
// The MathML body without the wrapper and the annotation.
const body = (tex, display = false) => {
  const r = texToMathML(tex, { display });
  return { m: r.mathml.replace(/^<math[^>]*><semantics>/, '').replace(/<annotation[\s\S]*$/, ''), error: r.error, full: r.mathml };
};
const has = (tex, part, name, display) => { const b = body(tex, display); ok(b.m.includes(part) && !b.error, name, b.error || b.m); };

export function run() {
  // Wrapper.
  const w = texToMathML('x', { display: true }).mathml;
  ok(w.startsWith('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics>') && w.includes('<annotation encoding="application/x-tex">x</annotation>'), 'math wrapper with the source');
  ok(texToMathML('x').mathml.includes('display="inline"'), 'inline by default');

  // Atoms.
  has('a+b=c', '<mi>a</mi><mo>+</mo><mi>b</mi><mo>=</mo><mi>c</mi>', 'identifiers and operators');
  has('3.14 - 2', '<mn>3.14</mn><mo>−</mo><mn>2</mn>', 'numbers and the minus sign');
  has('\\alpha + \\Omega', '<mi>α</mi><mo>+</mo><mi mathvariant="normal">Ω</mi>', 'Greek, capitals upright');
  has('\\varepsilon\\phi\\varphi', '<mi>ε</mi><mi>ϕ</mi><mi>φ</mi>', 'Greek variants');
  has('x \\le y \\ne z \\approx w', '<mo>≤</mo><mi>y</mi><mo>≠</mo><mi>z</mi><mo>≈</mo>', 'relations');
  has('A \\cup B \\subseteq C \\in \\emptyset', '<mo>∪</mo><mi>B</mi><mo>⊆</mo><mi>C</mi><mo>∈</mo><mi mathvariant="normal">∅</mi>', 'set theory');
  has('\\forall x \\exists y \\neg p \\land q', '<mo>∀</mo><mi>x</mi><mo>∃</mo><mi>y</mi><mo>¬</mo><mi>p</mi><mo>∧</mo>', 'logic');
  has('a \\to b \\Rightarrow c \\mapsto d', '<mo>→</mo><mi>b</mi><mo>⇒</mo><mi>c</mi><mo>↦</mo>', 'arrows');
  has('\\pm\\times\\cdot\\div', '<mo>±</mo><mo>×</mo><mo>⋅</mo><mo>÷</mo>', 'binary operators');
  has('a < b', '<mo>&lt;</mo>', 'escaping of <');
  has('\\text{a < b & "c"}', '<mtext>a &lt; b &amp; &quot;c&quot;</mtext>', 'escaping in text');

  // Scripts.
  has('x^2_i', '<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>', 'sub and superscript');
  has("f''(x)", '<msup><mi>f</mi><mo>″</mo></msup>', 'primes');
  has("f'^2", '<msup><mi>f</mi><mrow><mo>′</mo><mn>2</mn></mrow></msup>', 'prime and superscript');
  has('x^{a+b}', '<msup><mi>x</mi><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></msup>', 'grouped superscript');
  ok(body('x^2^3').error === 'Double superscript', 'double superscript is an error');

  // Fractions, binomials, roots.
  has('\\frac{a}{b}', '<mfrac><mi>a</mi><mi>b</mi></mfrac>', 'fraction');
  has('\\frac12', '<mfrac><mn>1</mn><mn>2</mn></mfrac>', 'fraction of single tokens');
  has('\\dfrac{a}{b}', '<mstyle displaystyle="true" scriptlevel="0"><mfrac>', 'display fraction');
  has('\\binom{n}{k}', '<mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac>', 'binomial');
  has('{a \\over b}', '<mfrac><mi>a</mi><mi>b</mi></mfrac>', '\\over');
  has('\\sqrt{x}', '<msqrt><mi>x</mi></msqrt>', 'square root');
  has('\\sqrt[3]{x}', '<mroot><mi>x</mi><mn>3</mn></mroot>', 'n-th root');

  // Large operators and limits.
  has('\\sum_{i=1}^{n} i', '<munderover><mo largeop="true" movablelimits="true">∑</mo>', 'sum with limits in display', true);
  has('\\sum_{i=1}^{n} i', '<msubsup><mo largeop="true" movablelimits="true">∑</mo>', 'sum with scripts inline');
  has('\\int_0^1 f', '<msubsup><mo largeop="true">∫</mo><mn>0</mn><mn>1</mn></msubsup>', 'integral without limits', true);
  has('\\int\\limits_0^1 f', '<munderover><mo movablelimits="false" largeop="true">∫</mo>', '\\limits');
  has('\\sum\\nolimits_i', '<msub><mo largeop="true" movablelimits="true">∑</mo><mi>i</mi></msub>', '\\nolimits', true);
  has('\\lim_{x \\to 0} f', '<munder><mo lspace="0.1667em" rspace="0.1667em" movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder>', 'lim', true);
  has('\\sin x', '<mi>sin</mi><mo>⁡</mo><mspace width="0.1667em"/><mi>x</mi>', 'function names');
  has('\\sin(x)', '<mi>sin</mi><mo>⁡</mo><mo stretchy="false">(</mo>', 'no space before a bracket');
  has('|x| + \\vert y \\vert', '<mo stretchy="false" lspace="0" rspace="0">|</mo><mi>x</mi>', 'bars without spacing');
  has('\\sin^2 x', '<msup><mi>sin</mi><mn>2</mn></msup><mo>⁡</mo>', 'function with a power');
  has('\\operatorname{rank} A', '<mi>rank</mi><mo>⁡</mo>', 'operatorname');
  has('\\operatorname*{argmax}_x', '<munder><mo lspace="0.1667em" rspace="0.1667em" movablelimits="true">argmax</mo><mi>x</mi></munder>', 'operatorname*', true);

  // Delimiters.
  has('\\left( \\frac{a}{b} \\right]', '<mrow><mo fence="true" form="prefix" stretchy="true" symmetric="true">(</mo><mfrac>', '\\left \\right');
  has('\\left\\{ x \\middle| y \\right.', '<mo fence="true" stretchy="true" symmetric="true">|</mo>', '\\middle and the empty delimiter');
  has('\\left\\langle x \\right\\rangle', '>⟨</mo>', 'angle delimiters');
  has('\\left\\| v \\right\\|', '>‖</mo>', 'norm delimiters');
  has('\\big( x \\Big]', 'minsize="1.2em" maxsize="1.2em">(</mo>', '\\big');
  ok(body('\\left( x').error === 'Missing \\right', 'missing \\right');

  // Accents and braces.
  has('\\hat{x}', '<mover accent="true"><mi>x</mi><mo stretchy="false">^</mo></mover>', 'hat');
  has('\\widehat{xy}', '<mo stretchy="true">^</mo>', 'wide hat');
  has('\\overline{AB}', '<mover accent="true"><mrow><mi>A</mi><mi>B</mi></mrow><mo stretchy="true">‾</mo></mover>', 'overline');
  has('\\underline{x}', '<munder accentunder="true"><mi>x</mi><mo stretchy="true">_</mo></munder>', 'underline');
  has('\\vec v + \\dot x + \\tilde y', '<mo stretchy="false">→</mo></mover>', 'vec');
  has('\\overbrace{a+b}^{n}', '<mover><mover><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy="true">⏞</mo></mover><mi>n</mi></mover>', 'overbrace with a label');
  has('\\underbrace{a+b}_{n}', '<munder><munder>', 'underbrace with a label');
  has('\\overset{!}{=}', '<mover><mo>=</mo><mo>!</mo></mover>', 'overset');

  // Fonts.
  has('\\mathbb{R}', '<mi>ℝ</mi>', 'double-struck hole');
  has('\\mathbb{A}', '<mi>𝔸</mi>', 'double-struck');
  has('\\mathcal{L}', '<mi>ℒ</mi>', 'calligraphic');
  has('\\mathbf{v}', '<mi>𝐯</mi>', 'bold');
  has('\\mathrm{d}x', '<mi mathvariant="normal">d</mi><mi>x</mi>', 'roman letter');
  has('\\mathrm{max}', '<mi>max</mi>', 'roman word');
  has('\\boldsymbol{\\alpha}', '<mi>𝜶</mi>', 'bold Greek');
  ok(styled('h', 'it') === 'ℎ' && styled('Z', 'frak') === 'ℨ' && styled('7', 'bb') === '𝟟', 'alphanumeric styles');

  // Text.
  has('\\text{if } x', '<mtext>if </mtext>', 'text keeps trailing spaces');
  has('\\text{for $x>0$}', '<mtext>for </mtext><mrow><mi>x</mi><mo>&gt;</mo><mn>0</mn></mrow>', 'math inside text');
  has('\\textbf{A}', '<mtext>𝐀</mtext>', 'bold text');

  // Environments.
  has('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '<mtable class="tex-tab tex-mat" displaystyle="false"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true" symmetric="true">)</mo>', 'pmatrix');
  has('\\begin{bmatrix} 1 \\end{bmatrix}', 'symmetric="true">[</mo>', 'bmatrix');
  has('\\begin{vmatrix} 1 \\end{vmatrix}', 'symmetric="true">|</mo>', 'vmatrix');
  has('f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}', '<mrow><mo fence="true" form="prefix" stretchy="true" symmetric="true">{</mo><mtable class="tex-tab tex-cases"', 'cases');
  has('\\begin{aligned} a &= b \\\\ &= c \\end{aligned}', '<mtd columnalign="right" class="tex-r"><mi>a</mi></mtd><mtd columnalign="left" class="tex-l"><mi></mi><mo>=</mo><mi>b</mi></mtd>', 'aligned');
  has('\\begin{align*} a &= b & c &= d \\end{align*}', 'class="tex-r tex-g"', 'align* column pairs');
  has('\\begin{array}{|l|c|} \\hline a & b \\\\ \\hline c & d \\\\ \\hline \\end{array}', '<mtr class="tex-ht"><mtd columnalign="left" class="tex-l tex-vl"><mi>a</mi></mtd><mtd class="tex-vl tex-vr"><mi>b</mi></mtd></mtr><mtr class="tex-ht tex-hb">', 'array with rules');
  has('\\begin{gather} a \\\\ b \\end{gather}', '<mtable class="tex-tab" displaystyle="true"><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable>', 'gather');
  has('\\begin{equation} E = mc^2 \\end{equation}', '<mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup>', 'equation');
  has('\\sum_{\\substack{i<n \\\\ j}} x', '<mtable class="tex-tab tex-stack"', 'substack');
  ok(body('\\begin{pmatrix} a \\end{bmatrix}').error === '\\begin{pmatrix} ended by \\end{bmatrix}', 'mismatched environments');
  ok(/Unknown environment/.test(body('\\begin{foo} a \\end{foo}').error), 'unknown environments');
  has('a &= b \\\\ c &= d', '<mtable class="tex-tab tex-align"', 'rows at the top level', true);
  has('a \\\\ b', '<mtable class="tex-tab" displaystyle="true"><mtr><mtd><mi>a</mi></mtd></mtr>', 'lines at the top level', true);

  // Spacing, colour, misc.
  has('a\\,b\\quad c\\!d', '<mspace width="0.1667em"/><mi>b</mi><mspace width="1em"/><mi>c</mi><mspace width="-0.1667em"/>', 'spaces');
  has('a\\hspace{2em}b', '<mspace width="2em"/>', 'hspace');
  has('\\color{red}{x} y', '<mstyle mathcolor="red"><mi>x</mi><mi>y</mi></mstyle>', 'colour switch');
  has('\\textcolor{#00f}{x}', '<mstyle mathcolor="#00f"><mi>x</mi></mstyle>', 'textcolor');
  ok(!body('\\color{red;x:y}{x}').m.includes('mathcolor'), 'unsafe colours are dropped');
  has('a \\not= b \\not\\in C', '<mo>≠</mo><mi>b</mi><mo>∉</mo>', '\\not');
  has('a \\pmod{n}', '<mi>mod</mi><mspace width="0.3333em"/><mi>n</mi>', 'pmod');
  has('1, \\ldots, n \\cdots', '<mo>…</mo><mo>,</mo><mi>n</mi><mo>⋯</mo>', 'dots');
  has('E = mc^2 \\tag{1}', '<mspace width="2em"/><mtext>(1)</mtext>', 'tag', true);
  has('\\displaystyle \\frac{a}{b}', '<mstyle displaystyle="true" scriptlevel="0"><mfrac>', 'displaystyle');
  has('x % comment\n+ y', '<mi>x</mi><mo>+</mo><mi>y</mi>', 'comments');
  has('\\xrightarrow{f} B', '<mover><mo stretchy="true" minsize="1.8em">→</mo>', 'xrightarrow');

  // Errors never throw.
  const u = body('\\foo x');
  ok(u.error === 'Unknown command \\foo' && u.m.includes('<merror><mtext>\\foo</mtext></merror><mi>x</mi>'), 'unknown commands render in place', u);
  const e1 = body('{a');
  ok(e1.error === 'Missing }' && e1.m === '<merror><mtext>{a</mtext></merror>', 'unbalanced braces give the source', e1);
  ok(body('a}').error === 'Unexpected }', 'unexpected }');
  ok(body('<script>{').m.includes('&lt;script&gt;'), 'the fallback is escaped');
  ok(body('\\').error === 'Trailing \\', 'trailing backslash');
  ok(body('{'.repeat(500) + 'x' + '}'.repeat(500)).error === 'Too deeply nested', 'deep nesting');
  ok(texToMathML(null).error === null && texToMathML('').mathml.includes('<mrow></mrow>'), 'empty input');
  ok(MATH_CSS.includes('display:block math'), 'CSS');

  console.log(`math: ${passed} passed, ${failed} failed`);
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run() ? 1 : 0;
