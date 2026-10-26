// resume-app/i18n-en.js - resume editor UI strings: resume blocks and the app identity (English).
//
// Only resume-specific keys: generic studio / paper keys live in their own dictionaries and are merged by addDicts.
// Grouped by area with short comments; English is the reference set and the fallback for missing keys.
import { addDicts } from '../ui/i18n.js';

addDicts({
  en: {
    // app shell
    'app.name': 'Resume Builder',
    'app.tagline': 'Single-file resume page builder',
    // files
    'files.empty': 'No files yet. Add certificates, diplomas, a portfolio or a photo.',
    // block schema fields
    'f.photo': 'Photo',
    'f.photoShape': 'Photo shape',
    'f.photoSize': 'Photo size',
    'f.layout': 'Layout',
    'f.icons': 'Show icons',
    'f.showLabels': 'Show labels',
    'f.kind': 'Type',
    'f.value': 'Value',
    'f.href': 'Link (auto if empty)',
    'f.label': 'Label',
    'f.dateFormat': 'Date format',
    'f.showDuration': 'Show duration',
    'f.datePos': 'Date position',
    'f.start': 'Start',
    'f.end': 'End',
    'f.title': 'Title',
    'f.org': 'Organization',
    'f.location': 'Location',
    'f.tags': 'Tags',
    'f.name': 'Name',
    'f.group': 'Group',
    'f.showLevel': 'Show level',
    'f.columns': 'Columns',
    'f.groupBy': 'Group by category',
    'f.note': 'Note',
    'f.cols': 'Columns',
    'f.k': 'Key',
    'f.v': 'Value',
    // options
    'o.square': 'Square',
    'o.split': 'Split',
    'o.list': 'List', 'o.inline': 'Inline',
    'o.classic': 'Classic', 'o.line': 'Line',
    'o.cards': 'Cards',
    'o.month': 'Month (Jan 2024)', 'o.monthLong': 'Full month (January 2024)', 'o.year': 'Year only', 'o.numeric': 'Numeric (05/2024)',
    'o.bars': 'Bars', 'o.dots': 'Dots', 'o.tags': 'Tags',
    'o.C2': 'C2 — Proficient', 'o.C1': 'C1 — Advanced', 'o.B2': 'B2 — Upper-intermediate',
    'o.B1': 'B1 — Intermediate', 'o.A2': 'A2 — Elementary', 'o.A1': 'A1 — Beginner',
    'o.table': 'Table', 'o.stacked': 'Stacked',
    // block types
    'b.profile': 'Profile', 'b.contacts': 'Contacts', 'b.timeline': 'Timeline',
    'b.skills': 'Skills', 'b.languages': 'Languages', 'b.keyvalue': 'Key–value list',
    'bd.profile': 'Name, job title, photo and a short summary.',
    'bd.contacts': 'Email, phone, website and social profiles with icons.',
    'bd.timeline': 'Experience or education entries with dates.',
    'bd.skills': 'Skills with levels as bars, dots, tags or a list.',
    'bd.languages': 'Spoken languages with CEFR levels.',
    'bd.keyvalue': 'Pairs like “Driver’s license — B”.',
    // categories
    'c.resume': 'Resume',
    // contact kinds
    'ck.email': 'Email', 'ck.phone': 'Phone', 'ck.web': 'Website', 'ck.location': 'Location', 'ck.linkedin': 'LinkedIn',
    'ck.github': 'GitHub', 'ck.codeberg': 'Codeberg', 'ck.gitlab': 'GitLab', 'ck.telegram': 'Telegram', 'ck.whatsapp': 'WhatsApp',
    'ck.x': 'X (Twitter)', 'ck.mastodon': 'Mastodon', 'ck.skype': 'Skype', 'ck.birth': 'Date of birth', 'ck.other': 'Other',
    // projects
    'pj.untitled': 'Untitled resume',
    // open / save
    'io.badFile': 'This file is not a resume project.',
    // inspector, zoom, landmarks, file pickers
    'io.typeOpen': 'Resume project or exported page',
    'io.typeProject': 'Resume project (.json)',
    // keyboard / validation papercuts (batch E31–E40)
    'fld.durationHint': 'Shown for items with both dates. For a current role, tick “Present” as the end date.',
  },
});
