const GEO_SANS='"Noto Sans Georgian", "BPG Glaho", Sylfaen, "DejaVu Sans"';const GEO_SERIF='"Noto Serif Georgian", Sylfaen, "DejaVu Serif"';const FONT_STACKS={sans:'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", '+GEO_SANS+', sans-serif',humanist:'"Segoe UI", Candara, Optima, "Fira Sans", "PT Sans", Ubuntu, "Noto Sans", '+GEO_SANS+', sans-serif',geometric:'Avenir, "Avenir Next", Montserrat, "Century Gothic", Futura, "Trebuchet MS", "Noto Sans", '+GEO_SANS+', sans-serif',serif:'Charter, "Bitstream Charter", "Sitka Text", Cambria, "PT Serif", Georgia, "Noto Serif", '+GEO_SERIF+', serif',slab:'Rockwell, "Rockwell Nova", "Roboto Slab", "Zilla Slab", "Noto Serif", Georgia, '+GEO_SERIF+', serif',mono:'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", '+GEO_SANS+', monospace',};const LAYOUTS=['single','sidebar-left','sidebar-right','two-col'];const DENSITY={compact:0.6,normal:1,airy:1.4};const HEADING_STYLES=['line','band','plain','caps','underline','side'];const PAPER_THEMES={classic:{vars:{accent:'#1d3557',text:'#1f2328',muted:'#5b6470',bg:'#ffffff',sideBg:'#f2f4f7',sideText:'',fontBody:'serif',fontHead:'serif',headingStyle:'line',radius:2},css:`
.__P__-root.__P__-t-classic .__P__-header{border-bottom:2px solid var(--__P__-accent);padding-bottom:calc(var(--__P__-gap)*4mm)}
.__P__-root.__P__-t-classic .__P__-header:has(>.__P__-b-divider:last-child){border-bottom:0;padding-bottom:0}
.__P__-root.__P__-t-classic .__P__-pf-name{letter-spacing:.01em}
.__P__-root.__P__-t-classic .__P__-pf-title{color:var(--__P__-muted);font-style:italic;font-weight:400}
.__P__-root.__P__-t-classic .__P__-hx{font-variant:small-caps;letter-spacing:.05em;font-size:1.25em}
.__P__-root.__P__-t-classic .__P__-tag{background:none;border:1px solid color-mix(in srgb,var(--__P__-accent) 35%,transparent)}
.__P__-root.__P__-t-classic .__P__-tl-title{font-style:normal}
.__P__-root.__P__-t-classic .__P__-tl-org{font-style:italic}`,},modern:{vars:{accent:'#0f766e',text:'#1f2937',muted:'#5f6672',bg:'#ffffff',sideBg:'#f1f5f9',sideText:'',fontBody:'sans',fontHead:'sans',headingStyle:'line',radius:6},css:`
.__P__-root.__P__-t-modern .__P__-pf-name{font-weight:800;letter-spacing:-.02em}
.__P__-root.__P__-t-modern .__P__-pf-title{font-weight:600}
.__P__-root.__P__-t-modern .__P__-hx{letter-spacing:-.005em}
.__P__-root.__P__-t-modern .__P__-side .__P__-hx{font-size:1.05em}
.__P__-root.__P__-t-modern .__P__-tl-org{font-weight:600}`,},minimal:{vars:{accent:'#111827',text:'#111827',muted:'#6b7280',bg:'#ffffff',sideBg:'#ffffff',sideText:'',fontBody:'humanist',fontHead:'humanist',headingStyle:'caps',radius:0},css:`
.__P__-root.__P__-t-minimal .__P__-pf-name{font-weight:300;font-size:2.6em;letter-spacing:-.015em}
.__P__-root.__P__-t-minimal .__P__-pf-title{color:var(--__P__-muted);text-transform:uppercase;letter-spacing:.16em;font-size:.86em;font-weight:500}
.__P__-root.__P__-t-minimal .__P__-hx{font-size:.78em;color:var(--__P__-muted);letter-spacing:.2em}
.__P__-root.__P__-t-minimal .__P__-side{background:none;padding:0;border-radius:0}
.__P__-root.__P__-t-minimal .__P__-meter{height:.2em}
.__P__-root.__P__-t-minimal .__P__-tag{background:none;padding:0;border-radius:0;color:inherit}
.__P__-root.__P__-t-minimal .__P__-tag+.__P__-tag::before{content:"·";margin-inline-end:.6em;color:var(--__P__-muted)}
.__P__-root.__P__-t-minimal .__P__-qt{background:none}`,},creative:{vars:{accent:'#7c3aed',text:'#1e1b4b',muted:'#64618a',bg:'#ffffff',sideBg:'#2e1065',sideText:'#ede9fe',fontBody:'geometric',fontHead:'geometric',headingStyle:'band',radius:10},css:`
.__P__-root.__P__-t-creative .__P__-page{background-image:linear-gradient(90deg,var(--__P__-accent),#db2777);background-size:100% 7px;background-repeat:no-repeat}
@media print{.__P__-root.__P__-t-creative .__P__-page{padding-top:calc(7px + 4mm)!important}}
.__P__-root.__P__-t-creative .__P__-pf-name{font-weight:800;letter-spacing:-.02em;color:var(--__P__-accent)}
@supports (background-clip:text) or (-webkit-background-clip:text){.__P__-root.__P__-t-creative[data-mode=view] .__P__-pf-name{background:linear-gradient(90deg,var(--__P__-accent),#db2777);-webkit-background-clip:text;background-clip:text;color:transparent}}
.__P__-root.__P__-t-creative .__P__-pf-photo{box-shadow:0 0 0 3px var(--__P__-bg),0 0 0 5px var(--__P__-accent)}
.__P__-root.__P__-t-creative:is(.__P__-l-sidebar-left,.__P__-l-sidebar-right) .__P__-side{--__P__-accent:color-mix(in srgb,var(--__P__-a0) 35%,#fff);--__P__-on-accent:#111827;--__P__-muted:color-mix(in srgb,var(--__P__-side-text,#fff) 72%,transparent);--__P__-bg:var(--__P__-side-bg)}
.__P__-root.__P__-t-creative.__P__-h-band:is(.__P__-l-sidebar-left,.__P__-l-sidebar-right) .__P__-side .__P__-hx{background:rgba(255,255,255,.13);color:inherit}
.__P__-root.__P__-t-creative:is(.__P__-l-sidebar-left,.__P__-l-sidebar-right) .__P__-side .__P__-tag{background:rgba(255,255,255,.12);color:inherit}
@media screen and (max-width:760px){.__P__-root.__P__-t-creative.__P__-h-band.__P__-side-id .__P__-side .__P__-hx{background:var(--__P__-accent);color:var(--__P__-on-accent,#fff)}}
@media screen and (max-width:760px){.__P__-root.__P__-t-creative.__P__-side-id .__P__-side .__P__-tag{background:var(--__P__-tint);color:color-mix(in srgb,var(--__P__-accent) 80%,var(--__P__-text))}}
.__P__-root.__P__-t-creative .__P__-tl-cards .__P__-tl-item{box-shadow:0 2px 10px rgba(46,16,101,.08)}`,},elegant:{vars:{accent:'#8a5d34',text:'#2b2523',muted:'#6e635d',bg:'#fffdf9',sideBg:'#f6f0e8',sideText:'',fontBody:'humanist',fontHead:'serif',headingStyle:'underline',radius:3},css:`
.__P__-root.__P__-t-elegant .__P__-pf-name{font-weight:400;letter-spacing:.1em;text-transform:uppercase}
.__P__-root.__P__-t-elegant .__P__-pf-title{color:var(--__P__-accent);letter-spacing:.22em;text-transform:uppercase;font-size:.9em;font-weight:400}
.__P__-root.__P__-t-elegant .__P__-hx{font-weight:600;letter-spacing:.06em}
.__P__-root.__P__-t-elegant .__P__-header{border-bottom:1px solid color-mix(in srgb,var(--__P__-accent) 45%,transparent);padding-bottom:calc(var(--__P__-gap)*4mm)}
.__P__-root.__P__-t-elegant .__P__-header:has(>.__P__-b-divider:last-child){border-bottom:0;padding-bottom:0}
.__P__-root.__P__-t-elegant .__P__-tl-title{font-family:var(--__P__-font-h);font-weight:600}
.__P__-root.__P__-t-elegant .__P__-hr{border-top-color:color-mix(in srgb,var(--__P__-accent) 50%,transparent)}`,},mono:{vars:{accent:'#000000',text:'#000000',muted:'#444444',bg:'#ffffff',sideBg:'#ffffff',sideText:'',fontBody:'sans',fontHead:'sans',headingStyle:'side',radius:0},css:`
.__P__-root.__P__-t-mono .__P__-side{background:none;padding:0;border-radius:0}
.__P__-root.__P__-t-mono .__P__-meter{background:none;box-shadow:inset 0 0 0 1px currentColor}
.__P__-root.__P__-t-mono .__P__-meter>i{background:currentColor}
.__P__-root.__P__-t-mono .__P__-dots>i,.__P__-root.__P__-t-mono .__P__-seg>i{background:none;box-shadow:inset 0 0 0 1px currentColor}
.__P__-root.__P__-t-mono .__P__-dots>i.on,.__P__-root.__P__-t-mono .__P__-seg>i.on{background:currentColor}
.__P__-root.__P__-t-mono .__P__-tag{background:none;border:1px solid currentColor;color:inherit}
.__P__-root.__P__-t-mono .__P__-table th{background:none}
.__P__-root.__P__-t-mono .__P__-qt{background:none}
.__P__-root.__P__-t-mono .__P__-pf-photo,.__P__-root.__P__-t-mono .__P__-img{filter:grayscale(1)}
.__P__-root.__P__-t-mono .__P__-tl-cards .__P__-tl-item{background:none}`,},};export{LAYOUTS,FONT_STACKS,DENSITY,HEADING_STYLES,PAPER_THEMES};