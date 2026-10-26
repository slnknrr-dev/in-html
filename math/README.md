# math/

TeX / LaTeX math to **MathML Core**: browsers lay the formulas out natively, so there are no fonts, no style sheets
of glyph boxes and no scripts to ship. Written for the formulas of README files (`$…$`, `$$…$$`, ```` ```math ````,
`` $`…`$ ``) as GitHub and Codeberg render them. Pure ES modules, importable in Node; MathML comes out as text.

| file | contents |
| --- | --- |
| `tex.js` | `texToMathML(tex, { display })` → `{ mathml, error }`: a recursive-descent parser that writes MathML directly; `MATH_CSS` |
| `symbols.js` | symbol tables (Greek, operators, relations, arrows, set theory, logic, large operators, functions, delimiters, accents, negations) and `styled(char, font)`: Unicode mathematical alphanumerics for font switches |
| `test.js` | unit tests: `node math/test.js` (also `node check.js tests math`) |

## API

```js
import { texToMathML, MATH_CSS } from '../math/tex.js';
texToMathML('\\frac{a}{b}', { display: true });
// { mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mfrac>…</mfrac></mrow>
//            <annotation encoding="application/x-tex">\frac{a}{b}</annotation></semantics></math>', error: null }
```

`texToMathML` never throws. Unknown commands render in place as `<merror>` and `error` names the first one;
structural errors (unbalanced braces, a missing `\right` or `\end`, double scripts) give the whole source in
`<merror><mtext>…</mtext></merror>`. Every character of the input is escaped. `MATH_CSS` sets the math font stack,
`display="block"` formulas (`display: block math`, horizontal scrolling), errors and the `tex-*` classes of tables.

Elements and attributes used: `math semantics annotation mrow mi mn mo mtext mspace mfrac msqrt mroot msub msup
msubsup munder mover munderover mtable mtr mtd mstyle mpadded mphantom merror`; `display xmlns encoding mathvariant
(normal only) stretchy fence form symmetric largeop movablelimits lspace rspace minsize maxsize accent accentunder
linethickness displaystyle scriptlevel mathcolor columnalign width class`. A sanitizer in front of the output must keep
them (and `class` values starting with `tex-`).

## Supported

- identifiers, numbers (`3.14` is one `<mn>`), operators with TeX's minus and asterisk; `%` comments; `~` and `\ `
- `^`, `_`, primes `'`, grouped scripts; double scripts are errors
- `\frac \dfrac \tfrac \cfrac \binom \dbinom \tbinom`, `\over \choose \atop`, `\sqrt`, `\sqrt[n]`
- large operators `\sum \prod \coprod \bigcup \bigcap \bigvee \bigwedge \bigoplus \bigotimes \bigodot \biguplus
  \bigsqcup` (limits under / over in display style, beside inline), integrals `\int \iint \iiint \iiiint \oint \oiint`
  (limits beside), `\limits \nolimits`; functions `\sin \cos \log \ln \exp \arg \dim \ker …`, with limits `\lim \limsup
  \liminf \max \min \sup \inf \det \gcd \Pr`; `\operatorname{…}`, `\operatorname*{…}`, `\mathop`
- Greek with variants, capitals upright; relations, binary operators, arrows (also `\iff \implies`), set theory and
  logic symbols, `\infty \partial \nabla \hbar \ell \aleph …`, `\ldots \cdots \vdots \ddots`, `\N \R \Z \Q \C`
- accents `\hat \widehat \check \tilde \widetilde \acute \grave \dot \ddot \dddot \breve \bar \vec \mathring
  \overline \underline \overrightarrow \overleftarrow …`; `\overbrace{}^{} \underbrace{}_{}`, `\overset \underset
  \stackrel`, `\xrightarrow[below]{above}` and relatives
- `\left \middle \right` with `. ( ) [ ] \{ \} | \| / \backslash \langle \rangle \lfloor \rfloor \lceil \rceil
  \uparrow …`, `\big \Big \bigg \Bigg` (+ `l r m`)
- fonts `\mathbb \mathbf \mathit \mathrm \mathsf \mathtt \mathcal \mathscr \mathfrak \boldsymbol \bm` (and `\rm \bf
  \it …` switches) as Unicode mathematical alphanumerics; `\text \textbf \textit \textsf \texttt \mbox \emph` with
  inner `$…$`
- environments `matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix smallmatrix`, `cases dcases rcases`, `aligned align
  align* split alignat`, `gather gather* gathered`, `equation equation*`, `array darray subarray` (column alignment
  `l c r p{}`, vertical rules, `\hline`), `\substack`; rows split by `\\` at the top level become an aligned table
- spacing `\, \: \; \! \quad \qquad \enspace \hspace{} \kern \mkern`, `\color{}` (switch), `\textcolor{}{}` (colour
  names and hex only), `\not`, `\pmod \bmod \mod`, `\displaystyle \textstyle \scriptstyle`, `\tag{}` (at the right),
  `\boxed`, `\phantom`; `\label \nonumber` are ignored

## Limits

- Layout is the browser's: MathML Core in Chromium, Firefox and Safari. Column alignment and rules of tables come
  from `MATH_CSS` classes (MathML Core has no `columnlines`).
- No macros (`\newcommand`, `\def`), no `\begin{tikzcd}`, no chemistry (`\ce`), no `\cancel`; such commands are
  reported as unknown.
- Equation numbers: only `\tag{}`; environments are not numbered automatically.
- Font switches cover Latin letters, digits and (bold / italic) Greek; other characters keep their shape.
