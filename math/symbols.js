// math/symbols.js - symbol tables of TeX math for math/tex.js: every control word that stands for one character, with
// its class (how it becomes MathML), delimiters, accents, functions, negations and the Unicode mathematical
// alphanumeric styles that replace font switches (MathML Core renders mathvariant only as 'normal').
//
//   SYMBOLS { name: [char, cls] }   cls: 'mi' identifier (italic when one letter), 'mu' upright identifier,
//                                   'bin' / 'rel' / 'open' / 'close' / 'punct' / 'mo' operators, 'fence' bar without spacing,
//                                   'big' large operator with limits in display, 'int' large operator without,
//                                   'fn' function name (sin), 'fnl' function name with limits (lim, max)
//   DELIMS { name | char: char }    what \left, \right, \middle and \big… accept ('.' is the empty delimiter)
//   ACCENTS { name: [char, stretchy, under] }
//   NEGATED { name | char: char }   \not before a relation
//   styled(char, font) -> char      font: bf it bsym rm sf sfbf sfit tt bb cal scr frak bffrak
//
// Tables are written as whitespace-separated "name char" pairs and expanded by table(): compact to read and edit,
// and one loop instead of hundreds of object literals. The class decides MathML element and spacing in tex.js.

const table = (cls, s, into) => { const p = s.trim().split(/\s+/); for (let i = 0; i < p.length; i += 2) into[p[i]] = [p[i + 1], cls]; return into; };

export const SYMBOLS = {};
table('mi', `alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι kappa κ
  varkappa ϰ lambda λ mu μ nu ν xi ξ omicron ο pi π varpi ϖ rho ρ varrho ϱ sigma σ varsigma ς tau τ upsilon υ phi ϕ
  varphi φ chi χ psi ψ omega ω digamma ϝ infty ∞ partial ∂ nabla ∇ hbar ℏ hslash ℏ ell ℓ aleph ℵ beth ℶ gimel ℷ wp ℘
  imath ı jmath ȷ eth ð mho ℧`, SYMBOLS);
table('mu', `Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω emptyset ∅ varnothing ∅
  Re ℜ Im ℑ angle ∠ measuredangle ∡ triangle △ top ⊤ bot ⊥ clubsuit ♣ diamondsuit ♢ heartsuit ♡ spadesuit ♠ flat ♭
  natural ♮ sharp ♯ checkmark ✓ dagger † ddagger ‡ S § P ¶ degree ° copyright © surd √ Box □ square □ blacksquare ■
  Diamond ◇ lozenge ◊ blacktriangle ▲ complement ∁ prime ′ backprime ‵ textdegree ° euro € pounds £ yen ¥
  N ℕ R ℝ Z ℤ Q ℚ C ℂ Reals ℝ Complex ℂ natnums ℕ`, SYMBOLS);
table('bin', `pm ± mp ∓ times × div ÷ cdot ⋅ cdotp ⋅ centerdot ⋅ circ ∘ ast ∗ star ⋆ bullet ∙ oplus ⊕ ominus ⊖ otimes ⊗
  oslash ⊘ odot ⊙ cup ∪ cap ∩ uplus ⊎ sqcup ⊔ sqcap ⊓ vee ∨ lor ∨ wedge ∧ land ∧ setminus ∖ smallsetminus ∖ wr ≀
  diamond ⋄ bigtriangleup △ bigtriangledown ▽ triangleleft ◃ triangleright ▹ lhd ⊲ rhd ⊳ unlhd ⊴ unrhd ⊵ amalg ⨿
  ltimes ⋉ rtimes ⋊ boxplus ⊞ boxtimes ⊠ boxminus ⊟ boxdot ⊡ dotplus ∔ divideontimes ⋇ intercal ⊺ barwedge ⊼
  curlyvee ⋎ curlywedge ⋏`, SYMBOLS);
table('rel', `leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ approx ≈ approxeq ≊ equiv ≡ sim ∼ thicksim ∼ simeq ≃ cong ≅ propto ∝
  varpropto ∝ ll ≪ gg ≫ lll ⋘ ggg ⋙ prec ≺ succ ≻ preceq ⪯ succeq ⪰ subset ⊂ supset ⊃ subseteq ⊆ supseteq ⊇
  subsetneq ⊊ supsetneq ⊋ sqsubset ⊏ sqsupset ⊐ sqsubseteq ⊑ sqsupseteq ⊒ in ∈ ni ∋ owns ∋ notin ∉ vdash ⊢ dashv ⊣
  models ⊨ vDash ⊨ Vdash ⊩ mid ∣ nmid ∤ parallel ∥ nparallel ∦ perp ⊥ asymp ≍ doteq ≐ bowtie ⋈ smile ⌣ frown ⌢
  leqslant ⩽ geqslant ⩾ lesssim ≲ gtrsim ≳ lessgtr ≶ gtrless ≷ coloneqq ≔ coloneq ≔ eqqcolon ≕ triangleq ≜ eqsim ≂
  nleq ≰ ngeq ≱ nless ≮ ngtr ≯ nsim ≁ ncong ≇ nsubseteq ⊈ nsupseteq ⊉ lneq ⪇ gneq ⪈ nequiv ≢ therefore ∴ because ∵
  to → rightarrow → gets ← leftarrow ← leftrightarrow ↔ Rightarrow ⇒ Leftarrow ⇐ Leftrightarrow ⇔ iff ⟺ implies ⟹
  impliedby ⟸ longrightarrow ⟶ longleftarrow ⟵ longleftrightarrow ⟷ Longrightarrow ⟹ Longleftarrow ⟸
  Longleftrightarrow ⟺ mapsto ↦ longmapsto ⟼ uparrow ↑ downarrow ↓ updownarrow ↕ Uparrow ⇑ Downarrow ⇓
  Updownarrow ⇕ nearrow ↗ searrow ↘ swarrow ↙ nwarrow ↖ hookrightarrow ↪ hookleftarrow ↩ rightharpoonup ⇀
  rightharpoondown ⇁ leftharpoonup ↼ leftharpoondown ↽ rightleftharpoons ⇌ leftrightharpoons ⇋ leadsto ⇝
  rightsquigarrow ⇝ twoheadrightarrow ↠ twoheadleftarrow ↞ rightrightarrows ⇉ leftleftarrows ⇇ circlearrowleft ↺
  circlearrowright ↻ curvearrowleft ↶ curvearrowright ↷ nrightarrow ↛ nleftarrow ↚ nRightarrow ⇏ nLeftarrow ⇍
  nleftrightarrow ↮ nLeftrightarrow ⇎ upuparrows ⇈ downdownarrows ⇊ restriction ↾ multimap ⊸`, SYMBOLS);
table('mo', `forall ∀ exists ∃ nexists ∄ neg ¬ lnot ¬ backslash ∖ colon : ldots … dots … dotsc … dotsb ⋯ dotso …
  cdots ⋯ vdots ⋮ ddots ⋱`, SYMBOLS);
table('fence', `vert | Vert ‖ | ‖ lvert | rvert | lVert ‖ rVert ‖`, SYMBOLS);
table('open', `langle ⟨ lfloor ⌊ lceil ⌈ lbrace { lbrack [ { { lgroup ⟮ ulcorner ⌜ llcorner ⌞`, SYMBOLS);
table('close', `rangle ⟩ rfloor ⌋ rceil ⌉ rbrace } rbrack ] } } rgroup ⟯ urcorner ⌝ lrcorner ⌟`, SYMBOLS);
table('big', `sum ∑ prod ∏ coprod ∐ bigcup ⋃ bigcap ⋂ bigvee ⋁ bigwedge ⋀ bigoplus ⨁ bigotimes ⨂ bigodot ⨀
  biguplus ⨄ bigsqcup ⨆`, SYMBOLS);
table('int', `int ∫ intop ∫ smallint ∫ iint ∬ iiint ∭ iiiint ⨌ oint ∮ oiint ∯ oiiint ∰`, SYMBOLS);
for (const f of 'arccos arcsin arctan arcctg arctg arg ch cos cosh cot coth csc ctg cth deg dim exp hom ker lg ln log sec sh sin sinh tan tanh tg th sgn'.split(' ')) SYMBOLS[f] = [f, 'fn'];
for (const f of 'det gcd inf lim max min Pr sup injlim projlim'.split(' ')) SYMBOLS[f] = [f, 'fnl'];
SYMBOLS.limsup = ['lim sup', 'fnl'];
SYMBOLS.liminf = ['lim inf', 'fnl'];

export const DELIMS = {
  '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', '|': '|', '/': '/', '<': '⟨', '>': '⟩', '.': '', '\\|': '‖',
  lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈',
  rceil: '⌉', vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', backslash: '\\', uparrow: '↑',
  downarrow: '↓', updownarrow: '↕', Uparrow: '⇑', Downarrow: '⇓', Updownarrow: '⇕', lgroup: '⟮', rgroup: '⟯',
  lmoustache: '⎰', rmoustache: '⎱', ulcorner: '⌜', urcorner: '⌝', llcorner: '⌞', lrcorner: '⌟',
};

// name: [mark, stretchy, under]
export const ACCENTS = {
  hat: ['^', false], widehat: ['^', true], check: ['ˇ', false], widecheck: ['ˇ', true], tilde: ['~', false],
  widetilde: ['~', true], acute: ['´', false], grave: ['`', false], dot: ['˙', false], ddot: ['¨', false],
  dddot: ['⃛', false], breve: ['˘', false], bar: ['¯', false], vec: ['→', false], mathring: ['˚', false],
  overline: ['‾', true], overrightarrow: ['→', true], overleftarrow: ['←', true], overleftrightarrow: ['↔', true],
  Overrightarrow: ['⇒', true], underline: ['_', true, true], underrightarrow: ['→', true, true],
  underleftarrow: ['←', true, true], underleftrightarrow: ['↔', true, true], utilde: ['~', true, true],
};

export const NEGATED = {
  '=': '≠', '<': '≮', '>': '≯', in: '∉', ni: '∌', le: '≰', leq: '≰', ge: '≱', geq: '≱', equiv: '≢', sim: '≁',
  simeq: '≄', approx: '≉', cong: '≇', subset: '⊄', supset: '⊅', subseteq: '⊈', supseteq: '⊉', exists: '∄',
  mid: '∤', parallel: '∦', prec: '⊀', succ: '⊁', vdash: '⊬', models: '⊭',
};

// Mathematical alphanumeric symbols: [capital A, small a, digit 0] code points per font, and the letters the block
// leaves out because they were encoded earlier (Letterlike Symbols).
const ALPHA = {
  bf: [0x1d400, 0x1d41a, 0x1d7ce], it: [0x1d434, 0x1d44e, 0], bsym: [0x1d468, 0x1d482, 0x1d7ce],
  scr: [0x1d49c, 0x1d4b6, 0], cal: [0x1d49c, 0x1d4b6, 0], frak: [0x1d504, 0x1d51e, 0], bb: [0x1d538, 0x1d552, 0x1d7d8],
  bffrak: [0x1d56c, 0x1d586, 0], sf: [0x1d5a0, 0x1d5ba, 0x1d7e2], sfbf: [0x1d5d4, 0x1d5ee, 0x1d7ec],
  sfit: [0x1d608, 0x1d622, 0], tt: [0x1d670, 0x1d68a, 0x1d7f6],
};
const HOLES = {
  it: { h: 'ℎ' },
  scr: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
  frak: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  bb: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
};
HOLES.cal = HOLES.scr;
// Greek: [capital Α, small α] per font (bold upright, italic, bold italic).
const GREEK = { bf: [0x1d6a8, 0x1d6c2], it: [0x1d6e2, 0x1d6fc], bsym: [0x1d71c, 0x1d736] };

// Font switches become Unicode Mathematical Alphanumeric Symbols because MathML Core dropped mathvariant values
// other than 'normal'. Letters map by offset from A / a / 0 in the font's block; HOLES lists the letters encoded
// earlier in Letterlike Symbols (ℝ, ℂ, ℎ...) whose block slots are reserved and empty. U+03A2 is unassigned in
// Greek, but its slot exists in the math blocks (theta symbol), so offsets stay aligned by skipping only it.
export function styled(ch, font) {
  const a = ALPHA[font];
  if (!a) return ch;
  const h = HOLES[font] && HOLES[font][ch];
  if (h) return h;
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(a[0] + c - 65);
  if (c >= 97 && c <= 122) return String.fromCodePoint(a[1] + c - 97);
  if (c >= 48 && c <= 57) return a[2] ? String.fromCodePoint(a[2] + c - 48) : ch;
  const g = GREEK[font];
  if (g && c >= 0x391 && c <= 0x3a9 && c !== 0x3a2) return String.fromCodePoint(g[0] + c - 0x391);
  if (g && c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(g[1] + c - 0x3b1);
  return ch;
}
