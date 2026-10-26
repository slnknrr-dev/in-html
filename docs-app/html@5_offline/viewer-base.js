const VERSION='1.0.0';const UI_LANGS=['en','ru','de','fr','es','uk','ka'];const DOCS_THEMES={article:{vars:{accent:'#2f5fb3',text:'#1c232c',muted:'#5d6674',bg:'#fffefb',sideBg:'#f5f3ee',sideText:'',fontBody:'serif',fontHead:'sans',headingStyle:'plain',radius:4},css:`
.__P__-root.__P__-t-article .__P__-hx{color:var(--__P__-text);font-size:1.35em;letter-spacing:-.01em}
.__P__-root.__P__-t-article .__P__-hd1{font-size:2.3em;font-weight:800;letter-spacing:-.02em}
.__P__-root.__P__-t-article .__P__-hd3{color:var(--__P__-accent)}
.__P__-root.__P__-t-article .__P__-qt{border-inline-start-width:3px;background:none;font-size:1.06em}
.__P__-root.__P__-t-article .__P__-toc{padding:.9em 1.1em;border-radius:var(--__P__-radius);background:color-mix(in srgb,var(--__P__-text) 3.5%,var(--__P__-bg))}`,},report:{vars:{accent:'#0b4f6c',text:'#1b2430',muted:'#5a6575',bg:'#ffffff',sideBg:'#eef3f6',sideText:'',fontBody:'humanist',fontHead:'humanist',headingStyle:'line',radius:3},css:`
.__P__-root.__P__-t-report .__P__-hd1{font-size:2em;color:var(--__P__-accent);padding-bottom:.3em;border-bottom:3px solid var(--__P__-accent)}
.__P__-root.__P__-t-report .__P__-table th{background:color-mix(in srgb,var(--__P__-accent) 10%,var(--__P__-bg))}
.__P__-root.__P__-t-report .__P__-toc-l1{color:var(--__P__-accent)}`,},technical:{vars:{accent:'#6d28d9',text:'#18181b',muted:'#5f5f6b',bg:'#ffffff',sideBg:'#f5f3ff',sideText:'',fontBody:'sans',fontHead:'geometric',headingStyle:'side',radius:6},css:`
.__P__-root.__P__-t-technical .__P__-hd1{font-size:2.1em;letter-spacing:-.02em}
.__P__-root.__P__-t-technical .__P__-hd3,.__P__-root.__P__-t-technical .__P__-toc-no{font-family:ui-monospace,"Cascadia Code",Consolas,monospace}
.__P__-root.__P__-t-technical .__P__-pre{border-inline-start:3px solid var(--__P__-accent)}`,},};export{VERSION,UI_LANGS,DOCS_THEMES};