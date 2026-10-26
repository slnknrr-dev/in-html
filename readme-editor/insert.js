// readme-editor/insert.js - what the editor inserts: block templates (headings, lists, alerts, details, a centred
// header, a badge row, footnotes, keys, math, every diagram kind), the table of contents from the headings, the
// sample README, and the insert menu that offers them. Template texts follow the UI language.
//
// Templates are functions, not strings: t() must run at insertion time so the inserted text is in the current UI
// language (a string table built at import would freeze the startup language). Ids starting with '@' are not
// templates but actions handled by main.js runInsert (they open a dialog first).
// The HTML snippets (align="center", <details>, <kbd>) are the subset GitHub's sanitizer keeps; CSS or <style> would
// be stripped on the real site, so the editor never offers them.

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openPopover } from '../ui/overlays.js';
import { SHIELDS } from '../badge/shields.js';
import { S, renderMarkdown } from './doc.js';

// Values are trusted constants from this file; no escaping is applied because no user text reaches these helpers.
const img = (src, alt, extra = '') => `<img src="${src}" alt="${alt}"${extra}>`;
const badge = (path, alt) => img(SHIELDS + path, alt);

// One minimal but representative example per Mermaid diagram type, using its distinctive syntax (autonumber,
// milestones, PK markers), so a template doubles as a syntax reminder.
export const DIAGRAMS = {
  flowchart: () => `flowchart LR\n    A[${t('tpl.start')}] --> B{${t('tpl.question')}}\n    B -- ${t('tpl.yes')} --> C[${t('tpl.action')}]\n    B -- ${t('tpl.no')} --> D[${t('tpl.end')}]\n    C --> D`,
  sequence: () => `sequenceDiagram\n    autonumber\n    participant U as ${t('tpl.user')}\n    participant S as ${t('tpl.server')}\n    U->>S: ${t('tpl.request')}\n    activate S\n    S-->>U: ${t('tpl.response')}\n    deactivate S`,
  class: () => 'classDiagram\n    class Animal {\n        +String name\n        +speak() void\n    }\n    class Dog\n    Animal <|-- Dog',
  state: () => 'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : start\n    Running --> Idle : stop\n    Running --> [*]',
  er: () => 'erDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ ITEM : contains\n    USER {\n        int id PK\n        string name\n    }',
  gantt: () => `gantt\n    title ${t('tpl.plan')}\n    dateFormat YYYY-MM-DD\n    section ${t('tpl.stage')} 1\n    ${t('tpl.task')} A :a1, 2026-01-05, 7d\n    ${t('tpl.task')} B :after a1, 5d\n    section ${t('tpl.stage')} 2\n    ${t('tpl.release')} :milestone, 2026-01-20, 0d`,
  pie: () => `pie showData\n    title ${t('tpl.languages')}\n    "Rust" : 45\n    "Go" : 30\n    "Python" : 25`,
  git: () => 'gitGraph\n    commit\n    branch dev\n    checkout dev\n    commit\n    commit\n    checkout main\n    merge dev tag: "v1.0"',
  mindmap: () => `mindmap\n  root((${t('tpl.project')}))\n    Frontend\n    Backend\n      API\n    Docs`,
  timeline: () => `timeline\n    title ${t('tpl.history')}\n    2024 : v0.1\n    2025 : v1.0 : Plugins\n    2026 : v2.0`,
  journey: () => `journey\n    title ${t('tpl.journey')}\n    section ${t('tpl.stage')} 1\n      ${t('tpl.task')} A: 5: ${t('tpl.user')}\n      ${t('tpl.task')} B: 2: ${t('tpl.user')}`,
  quadrant: () => 'quadrantChart\n    x-axis Low --> High\n    y-axis Low --> High\n    quadrant-1 Do\n    quadrant-2 Plan\n    quadrant-3 Drop\n    quadrant-4 Delegate\n    A: [0.3, 0.6]\n    B: [0.75, 0.8]',
};
// Double backslashes: these are JS string literals, so '\\frac' yields the TeX source \frac.
const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';
export const MATH_SNIPPETS = [['fraction', '\\frac{a}{b}'], ['root', '\\sqrt{x}'], ['sum', '\\sum_{i=1}^{n} i'], ['integral', '\\int_a^b f(x)\\,dx'], ['limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x}'],
  ['matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'], ['cases', '\\begin{cases} x + y = 1 \\\\ x - y = 0 \\end{cases}'], ['greek', '\\alpha \\beta \\gamma \\pi']];

export const TEMPLATES = {
  h1: () => '# ' + t('tpl.title'), h2: () => '## ' + t('tpl.section'), h3: () => '### ' + t('tpl.subsection'),
  p: () => t('tpl.paragraph'), quote: () => '> ' + t('tpl.quote'), hr: () => '---',
  ul: () => [1, 2, 3].map((n) => `- ${t('tpl.item')} ${n}`).join('\n'), ol: () => [1, 2, 3].map((n) => `${n}. ${t('tpl.item')} ${n}`).join('\n'),
  task: () => `- [ ] ${t('tpl.todo')}\n- [x] ${t('tpl.done')}`,
  code: () => fence('js', 'console.log("Hello");'),
  details: () => `<details>\n<summary>${t('tpl.summary')}</summary>\n\n${t('tpl.hidden')}\n\n</details>`,
  kbd: () => t('tpl.press') + ' <kbd>Ctrl</kbd> + <kbd>S</kbd>',
  footnote: () => `${t('tpl.footText')}[^1].\n\n[^1]: ${t('tpl.footNote')}`,
  center: () => `<h1 align="center">${t('tpl.projectName')}</h1>\n\n<p align="center">${t('tpl.tagline')}</p>`,
  badges: () => `<p align="center">\n  <a href="LICENSE">${badge('/badge/license-MIT-blue', 'License')}</a>\n  ${badge('/badge/version-1.0.0-brightgreen', 'Version')}\n</p>`,
  mathBlock: () => '$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$',
  mathFence: () => fence('math', 'E = mc^2'),
  mathInline: () => '$x^2 + y^2 = r^2$',
  toc: () => tocMarkdown(),
};
// GitHub alert syntax ("> [!NOTE]"): the five types GitHub renders; others display as a plain quote.
for (const a of ['note', 'tip', 'important', 'warning', 'caution']) TEMPLATES['alert-' + a] = () => `> [!${a.toUpperCase()}]\n> ${t('alert.' + a + '.text')}`;
for (const k of Object.keys(DIAGRAMS)) TEMPLATES['mm-' + k] = () => fence('mermaid', DIAGRAMS[k]());

// Table of contents: nested list of the headings (below the first h1), linked by their GitHub anchors.
// The first h1 is skipped when other headings exist: it is the project title, a TOC entry for it is noise.
// Levels are shifted so the shallowest heading is at the left margin. Square brackets in heading text are escaped
// because they would close the link label early. Anchors are the slugs gfm.js computes the GitHub way.
export function tocMarkdown(text = S.text) {
  const hs = renderMarkdown(text).headings.filter((x, i, all) => !(x.level === 1 && i === 0 && all.length > 1));
  if (!hs.length) return '- ' + t('tpl.noHeadings');
  const min = Math.min(...hs.map((x) => x.level));
  return hs.map((x) => `${'  '.repeat(x.level - min)}- [${x.text.replace(/[[\]]/g, '\\$&')}](#${x.slug})`).join('\n');
}

export const MENU = [
  ['ins.text', ['h1', 'h2', 'h3', 'p', 'quote', 'hr', 'kbd', 'footnote', 'toc']],
  ['ins.lists', ['ul', 'ol', 'task']],
  ['ins.media', ['@table', '@tableHtml', '@image', '@badge', 'badges', 'center']],
  ['ins.blocks', ['alert-note', 'alert-tip', 'alert-important', 'alert-warning', 'alert-caution', 'details', 'code']],
  ['ins.math', ['mathBlock', 'mathFence', '@mathInline']],
  ['ins.diagrams', Object.keys(DIAGRAMS).map((k) => 'mm-' + k)],
];

// The insert menu: groups of buttons; run(id) gets a template id or an '@action'.
// role=menu/menuitem on a popover with groups; focus goes to the first item on the next frame (after the popover is
// attached and visible, otherwise focus() on a not-yet-rendered element is ignored). restoreFocus returns focus to
// the toolbar button on close.
export function openInsertMenu(anchor, run) {
  const body = h('div', { class: 're-insmenu', role: 'menu' });
  for (const [title, ids] of MENU) {
    body.append(h('div', { class: 're-insgroup' }, h('div', { class: 'ed-menu-h' }, t(title)),
      ids.map((id) => h('button', { type: 'button', class: 'ed-menu-item', role: 'menuitem', dataset: { id }, onclick: () => { pop.close(); run(id); } }, h('span', { class: 'ed-menu-l' }, t('ins.' + id.replace('@', '')))))));
  }
  const pop = openPopover(anchor, body, { className: 're-inspop', restoreFocus: true });
  requestAnimationFrame(() => body.querySelector('button')?.focus());
  return pop;
}

// The sample README is the onboarding: it exercises every feature the preview can edit in place (badges, alert,
// tasks, aligned table, block math, Mermaid, code, details), each annotated in the current language.
export function sample() {
  return `<h1 align="center">✨ ${t('tpl.projectName')}</h1>

<p align="center">
  ${badge('/badge/build-passing-brightgreen?style=for-the-badge', 'build')}
  ${badge('/badge/license-MIT-blue?style=for-the-badge', 'License')}
  ${badge('/badge/version-1.0.0-orange?style=for-the-badge', 'Version')}
</p>

${t('sample.intro')}

> [!TIP]
> ${t('sample.tip')}

## ${t('sample.features')}

- [x] Markdown + HTML, :rocket: emoji
- [x] ${t('sample.math')}: $E = mc^2$, $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$
- [ ] ${t('sample.yours')}

| ${t('sample.feature')} | ${t('sample.status')} | ${t('sample.note')} |
| :--------- | :----: | ---------------: |
| ${t('sample.tables')} | ✅ | ${t('sample.clickCell')} |
| Badges | ✅ | shields.io |
| Mermaid | ✅ | ${t('sample.clickDiagram')} |

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

${fence('mermaid', 'flowchart LR\n    A[Markdown] --> B{README}\n    B --> C[GitHub]\n    B --> D[Codeberg]')}

${fence('js', 'console.log("Hello, README!");')}

<details>
<summary>${t('tpl.summary')}</summary>

${t('tpl.hidden')}

</details>
`;
}
