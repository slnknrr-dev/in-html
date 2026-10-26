// site-studio/wiki-strings-en.js - editor strings, English (the reference dictionary; strings-<lang>.js have the
// same keys). Values are strings or plural objects { one, few, many, other } chosen by vars.n.
// Structure (data, header-level comments only): one flat object, keys namespaced by area (app.*, kp.* editor shell and
// panels, b.* block names, f.* field labels, o.* option labels, set.* reader features, theme.*); values are strings with
// {var} slots or plural objects (CLDR categories). en is the reference: ui/i18n.js falls back to it for a missing key,
// so every key must exist in wiki-strings-en.js.
export default {
  'app.name': 'Knowledge Processor',

  // shell
  'kp.bases': 'Knowledge bases', 'kp.undo': 'Undo', 'kp.redo': 'Redo', 'kp.togglePreview': 'Show or hide the preview', 'kp.lockAll': 'Lock all 451 content again',
  'kp.export': 'Publish', 'kp.saving': 'Saving…', 'kp.unsaved': 'Unsaved changes', 'kp.saved': 'Saved', 'kp.saveFailed': 'Could not save: {msg}',
  'kp.serverFailed': 'server not updated', 'kp.onServer': 'on the server', 'kp.noStorage': 'This browser does not allow storage here: changes are kept only until the tab is closed. Download a project file to keep them.',
  'kp.pages': 'Pages', 'kp.page': 'Page', 'kp.media': 'Media', 'kp.base': 'Base', 'kp.preview': 'Preview', 'kp.pageEditor': 'Page editor', 'kp.panes': 'Panels',

  // pages
  'kp.pagesCount': { one: '{n} page', other: '{n} pages' }, 'kp.newPage': 'New page', 'kp.newPageTitle': 'New page', 'kp.secret': '451',
  'kp.filterPages': 'Filter pages', 'kp.collapse': 'Collapse', 'kp.expand': 'Expand', 'kp.homePage': 'Home page', 'kp.secretPage': 'Secret page (451)',
  'kp.hasVariants': { one: '{n} secret variant', other: '{n} secret variants' }, 'kp.versionsN': { one: '{n} version', other: '{n} versions' },
  'kp.hiddenPage': 'Unlisted', 'kp.redirect': 'Redirect', 'kp.open': 'Open', 'kp.rename': 'Rename', 'kp.newChild': 'New child page',
  'kp.newSecretChild': 'New secret child page', 'kp.moveTo': 'Move to…', 'kp.moveUp': 'Move up', 'kp.moveDown': 'Move down', 'kp.makeHome': 'Make home page',
  'kp.duplicate': 'Duplicate', 'kp.makeSecret': 'Make secret (451)', 'kp.makePublic': 'Make public', 'kp.delete': 'Delete', 'kp.topLevel': '(top level)',
  'kp.parentPage': 'Parent page', 'kp.move': 'Move', 'kp.copySuffix': '(copy)', 'kp.cannotDuplicateSecret': 'Unlock and make the page public to duplicate it.',
  'kp.cannotDeleteHome': 'The home page cannot be deleted. Make another page the home page first.', 'kp.deletePage': 'Delete page',
  'kp.deletePageQ': 'Delete “{title}”?', 'kp.deletePageKids': { one: 'Delete “{title}”? Its {n} child page moves up one level.', other: 'Delete “{title}”? Its {n} child pages move up one level.' },
  'kp.pageTitle': 'Title', 'kp.noPage': 'No page selected.',

  // page editor
  'kp.pageActions': 'Page actions', 'kp.more': 'More', 'kp.pageSettings': 'Page settings', 'kp.slug': 'Address', 'kp.slugHint': 'Part of the URL: letters of any script, digits, “-” and “/” for nested pages.',
  'kp.slugHome': 'The home page is published at the root of the site; the address is used for links.', 'kp.slugFromTitle': 'Make the address from the title', 'kp.fromTitle': 'From title',
  'kp.displayTitle': 'Displayed title', 'kp.displayHint': 'Optional: a title with markup (italics, ruby) shown instead of the plain title.',
  'kp.categories': 'Categories', 'kp.category': 'category', 'kp.newCategory': 'New category', 'kp.categoryName': 'Category name',
  'kp.summary': 'Summary', 'kp.summaryHint': 'Shown in hover previews, cards and search results (else the first paragraph).', 'kp.image': 'Image', 'kp.imageHint': 'For previews and cards (else the first picture of the page).',
  'kp.date': 'Date', 'kp.author': 'Author', 'kp.toc': 'Table of contents', 'kp.layout': 'Width', 'kp.hiddenHint': 'Not in lists, random page and search; reachable by links.',
  'kp.redirectTarget': 'Redirect to', 'kp.pageLayers': 'Layers of this page', 'kp.pageLayersHint': 'Toggles that only this page has (the base’s layers are in Base settings).',
  'kp.newLayer': 'New layer', 'kp.layerName': 'Layer name', 'kp.onByDefault': 'shown by default', 'kp.remove': 'Remove',
  'kp.variants': 'Variants', 'kp.publicVersion': 'Public', 'kp.secretVersion': 'Secret version', 'kp.newVariant': 'Secret variant', 'kp.newVariantHint': 'An alternative of this page that opens only with a password (#?451=…)',
  'kp.renameVariant': 'Rename variant', 'kp.variantLabel': 'Name of the variant', 'kp.changePassword': 'Change password', 'kp.lock': 'Lock', 'kp.deleteVariant': 'Delete secret variant',
  'kp.deleteVariantQ': 'Delete this secret variant? Its content is lost.', 'kp.versions': 'Versions', 'kp.mainVersion': 'Main version', 'kp.versionN': 'Version {n}',
  'kp.newVersion': 'Version', 'kp.newVersionHint': 'Another version of the page (e.g. “simpler”); readers switch between versions', 'kp.simpler': 'Simpler', 'kp.fullVersion': 'Detailed',
  'kp.versionHint': 'Versions are alternative texts of the same page — for example a detailed and a simpler one. Any number, any names.',
  'kp.versionLabel': 'Name of the version', 'kp.versionCopy': 'Start from a copy of the current version', 'kp.add': 'Add', 'kp.renameVersion': 'Rename version',
  'kp.moveLeft': 'Move left', 'kp.moveRight': 'Move right', 'kp.deleteVersion': 'Delete version', 'kp.deleteVersionQ': 'Delete the version “{name}”?',
  'kp.whatLinksHere': 'What links here', 'kp.noBacklinks': 'No page links here yet.',
  'kp.lockedPage': 'This page is encrypted', 'kp.lockedVariant': 'This variant is encrypted', 'kp.lockedHint': 'Enter its password to edit it. The password is not stored; the content is decrypted in this tab only.',
  'kp.backToPublic': 'Public version', 'kp.secretPageEditing': 'Secret page: everything here is sealed with its password; without it the address is a plain 404.',
  'kp.variantEditing': 'Secret variant: readers without the password see the public version; with #?451=password they can switch to this one.',

  // blocks
  'kp.addBlock': 'Add block', 'kp.insertHere': 'Insert a block here', 'kp.hidden': 'hidden', 'kp.edit': 'Edit', 'kp.show': 'Show', 'kp.hide': 'Hide',
  'kp.blockLayer': 'Shown with layer', 'kp.noLayer': '(always shown)', 'kp.noLayersYet': 'No layers yet: add them in Base settings or Page settings.',
  'kp.addItem': 'Add item', 'kp.item': 'Item', 'kp.columnN': 'Column {n}', 'kp.row': 'Row', 'kp.column': 'Column',
  'kp.tiersHint': 'Pick the tiers (layers) of the block first.', 'kp.tiersPick': 'Each chosen layer is a line under the original (transcription, gloss, translation…).',
  'kp.ptsHint': '{n} points (edit in the diagram editor)', 'kp.editDiagram': 'Edit picture and regions', 'kp.diagramHint': 'Draw regions on the picture, drag labels to place their leader lines, link regions to pages.',
  'kp.linkPh': 'page, page#section or https://…', 'kp.color': 'Colour', 'kp.clear': 'Clear', 'kp.format': 'Formatting',
  'kp.mk.bold': 'Bold (Ctrl+B)', 'kp.mk.italic': 'Italic (Ctrl+I)', 'kp.mk.link': 'Link to a page (Ctrl+K)', 'kp.mk.heading': 'Heading', 'kp.mk.list': 'List',
  'kp.mk.quote': 'Quotation', 'kp.mk.ref': 'Footnote', 'kp.mk.cite': 'Citation', 'kp.mk.layer': 'Text of a layer', 'kp.mk.tip': 'Tooltip', 'kp.mk.ph': 'Placeholder to fill in', 'kp.mk.code': 'Code',

  // media
  'kp.addFiles': 'Add files (or drop them here)', 'kp.upload': 'Upload files', 'kp.mediaCount': { one: '{n} file', other: '{n} files' }, 'kp.noMedia': 'No files yet.',
  'kp.mediaItem': 'File', 'kp.name': 'Name', 'kp.alt': 'Alternative text', 'kp.altHint': 'What the picture shows, for screen readers and when it cannot load.',
  'kp.credit': 'Credit / source', 'kp.secretMedia': 'Only inside 451 content', 'kp.secretMediaHint': 'Never published in clear: the file travels encrypted inside the secret pages that use it.',
  'kp.usedOn': 'Used on: {list}', 'kp.unused': 'Not used on any public page.', 'kp.replace': 'Replace', 'kp.replaced': 'File replaced', 'kp.copyMarkup': 'Copy link markup',
  'kp.copied': 'Copied', 'kp.deleteMedia': 'Delete file', 'kp.deleteMediaQ': 'Delete this file?', 'kp.deleteMediaUsed': 'This file is used on: {list}. Delete it anyway?',
  'kp.properties': 'Properties', 'kp.choose': 'Choose…', 'kp.chooseMedia': 'Choose a file', 'kp.noFile': 'No file', 'kp.logo': 'Logo',

  // diagram editor
  'kp.dg.select': 'Select / move', 'kp.dg.point': 'Point', 'kp.dg.rect': 'Rectangle', 'kp.dg.circle': 'Circle', 'kp.dg.poly': 'Polygon', 'kp.dg.node': 'Box (concept map)',
  'kp.dg.help.select': 'Drag regions to move them, labels to place them (the leader line follows); arrows nudge, Delete removes.',
  'kp.dg.help.point': 'Click on the picture to place a point.', 'kp.dg.help.rect': 'Drag on the picture to draw a rectangle.', 'kp.dg.help.circle': 'Drag from the centre to draw a circle.',
  'kp.dg.help.poly': 'Click the corners; double-click or Enter to finish.', 'kp.dg.help.none': 'Click to place a labelled box (a node of a concept map).',
  'kp.dg.picture': 'Picture and look', 'kp.dg.noPicture': 'No picture', 'kp.dg.region': 'Region {n}', 'kp.dg.labelOnRegion': 'Label on the region',
  'kp.dg.empty': 'Choose a tool above and draw on the picture.', 'kp.dg.arrows': 'Arrows ({n})', 'kp.dg.addArrow': 'Add arrow', 'kp.apply': 'Apply',

  // 451
  'kp.deriving': 'Working with the password…', 'kp.derivingHint': 'The key is derived from the password with a deliberately slow function, so guessing is slow too.',
  'kp.password': 'Password', 'kp.passwordAgain': 'Repeat the password', 'kp.showPassword': 'Show the password', 'kp.passwordEmpty': 'Enter a password.', 'kp.passwordMismatch': 'The passwords differ.',
  'kp.passwordHint': 'Readers open this content with #?451=password at the end of the address or on the Unlock page. A lost password cannot be recovered.',
  'kp.unlockTitle': 'Unlock 451 content', 'kp.unlock': 'Unlock', 'kp.unlockWrong': 'This password opens nothing in this base.', 'kp.unlockedN': { one: 'Unlocked: {n} item', other: 'Unlocked: {n} items' },
  'kp.secretPageTitle': 'Secret page', 'kp.notePh': 'only you see it, e.g. “draft for the team”', 'kp.newSecretPage': 'New secret page (451)',
  'kp.secretPageHint': 'A secret page does not exist for readers without the password (a plain 404); its address, title and text are encrypted.',
  'kp.editorNote': 'Note in the editor', 'kp.newVariant2': 'New secret variant', 'kp.variantHint': 'Readers without the password see the public page; with it they can switch to this variant. It may have its own versions.',
  'kp.variantCopy': 'Start from a copy of the public page', 'kp.passwordChanged': 'Password changed', 'kp.homeCannotBeSecret': 'The home page cannot be secret.',
  'kp.makeSecretDropsVariants': 'The secret variants of this page are removed when the whole page becomes secret. Continue?',
  'kp.unlockFirst': 'Unlock the page first.', 'kp.makePublicQ': 'Publish this page in clear? Its content will be readable by everyone.',

  // base settings
  'kp.general': 'General', 'kp.baseTitle': 'Title', 'kp.tagline': 'Tagline', 'kp.contentLang': 'Language of the content', 'kp.contentLangHint': 'Used for hyphenation, sorting, dates and search.',
  'kp.readerLang': 'Language of the reader’s interface', 'kp.readerLangHint': 'Buttons, “Contents”, “References”, search and 404 texts of the published base.',
  'kp.look': 'Look', 'kp.theme': 'Theme', 'kp.accent': 'Accent colour', 'kp.accentHint': 'Links, buttons and highlights (empty: the theme’s colour).',
  'kp.navigation': 'Top navigation', 'kp.navHint': 'Links in the header and the side menu: a page address, [[category:…]] or https://…', 'kp.label': 'Label', 'kp.addLink': 'Add link',
  'kp.footer': 'Footer', 'kp.footerText': 'Footer text', 'kp.license': 'License line', 'kp.layers': 'Layers (toggles)',
  'kp.layersHint': 'Layers are parts of pages that readers show or hide with buttons: transcription, translations, glosses, commentary… Mark blocks or text with a layer.',
  'kp.rubyLayer': 'Layer of furigana / ruby', 'kp.rubyHint': 'Ruby text written as {base|reading} belongs to this layer.',
  'kp.features': 'Reader features', 'kp.security': '451 encryption', 'kp.kdf': 'Key derivation',
  'kp.kdfHint': 'Envelopes are AES-256-GCM with a key derived from the password. Changes apply to content sealed from now on; existing envelopes keep their settings.',
  'kp.kdfT': 'Passes (Argon2id t)', 'kp.kdfM': 'Memory, KiB (Argon2id m)', 'kp.kdfI': 'Iterations (PBKDF2)',
  'theme.encyclopedia': 'Encyclopedia', 'theme.fandom-dark': 'Fandom (dark)', 'theme.magazine': 'Magazine', 'theme.minimal': 'Minimal', 'theme.scholarly': 'Scholarly',
  'set.search': 'Search', 'set.previews': 'Hover previews of links', 'set.recent': 'Recent changes', 'set.random': 'Random page', 'set.allPages': 'All pages',
  'set.backlinks': 'What links here', 'set.crumbs': 'Breadcrumbs', 'set.unlock': 'Unlock page (451)', 'set.subpages': 'Subpages under articles', 'set.schemeToggle': 'Light / dark toggle',
  'set.footerInfo': '“Made with” line', 'set.lastEdited': 'Last edited date', 'set.numbered': 'Numbered contents', 'set.toc': 'Contents', 'set.tocMin': 'Automatic contents from this many headings',

  // preview
  'kp.addressHint': 'The address of this page in the chosen publishing mode', 'kp.back': 'Back', 'kp.previewMode': 'Publishing mode',
  'kp.mode.single': 'One file', 'kp.mode.static': 'Static site', 'kp.mode.server': 'Server', 'kp.device': 'Width', 'kp.dev.desktop': 'Desktop', 'kp.dev.tablet': 'Tablet', 'kp.dev.phone': 'Phone',
  'kp.openTab': 'Open the one-file version in a new tab', 'kp.previewUnavailable': 'The preview needs the reader bundle, which this copy does not have.', 'kp.popupBlocked': 'The browser blocked the new tab.',
  'kp.openHere': 'Open in the preview', 'kp.editPage': 'Edit page', 'kp.createPage': 'Create this page', 'kp.copyLink': 'Copy link markup',

  // publishing
  'kp.exportTitle': 'Publish', 'kp.exportSealed': { one: '{n} piece of 451 content is locked in the editor: it is published sealed, as it is.', other: '{n} pieces of 451 content are locked in the editor: they are published sealed, as they are.' },
  'kp.exportSealedAll': '451 content is always published encrypted; only envelopes leave the editor.', 'kp.download': 'Download',
  'kp.ex.single': 'One HTML file', 'kp.ex.singleHint': 'Every page, picture and the reader in one file that works offline and from disk; pages are #/addresses.',
  'kp.ex.static': 'Static site', 'kp.ex.staticHint': 'A file per page (search engines, no-JS readers) and a 404.html that serves virtual pages: GitHub / Codeberg Pages, Netlify, any static host.',
  'kp.ex.server': 'Server (Node.js)', 'kp.ex.serverHint': 'server.mjs for Node 18+: real addresses, 404 status for unknown pages and an editing API with a token.',
  'kp.ex.project': 'Project file', 'kp.ex.projectHint': 'The whole base with its files, to continue in another browser or keep a backup (import it under Knowledge bases).',
  'kp.ex.publish': 'Publish to a server', 'kp.ex.publishHint': 'Send the base to a running server of the “Server” export (its editing API).',
  'kp.ex.hosted': 'Published here', 'kp.ex.hostedHint': 'This server publishes the base at:', 'kp.urlStyle': 'Addresses', 'kp.urlStyleHint': 'clean: /page · folders: /page/ · html: /page.html (also works from a folder on disk)',
  'kp.style.clean': 'Clean (/page)', 'kp.style.folders': 'Folders (/page/)', 'kp.style.html': '.html files (/page.html)',
  'kp.basePath': 'Base path', 'kp.basePathHint': 'Optional: the folder of a project site, e.g. /repository/ (found automatically when empty).',
  'kp.siteURL': 'Site address', 'kp.siteURLHint': 'Optional: the full address for sitemap.xml and robots.txt.', 'kp.serverURL': 'Server address', 'kp.token': 'Token',
  'kp.serverURLMissing': 'Enter the server address.', 'kp.publish': 'Publish', 'kp.published': 'Published', 'kp.openSite': 'Open the site',
  'kp.exporting': 'Preparing: {what}…', 'kp.exportFailed': 'Publishing failed: {msg}',

  // bases
  'kp.inBrowser': 'In this browser', 'kp.newBase': 'New knowledge base from a template', 'kp.import': 'Import a project file (.zip / .json)', 'kp.onServerTitle': 'On this server',
  'kp.loading': 'Loading…', 'kp.uploadToServer': 'Upload the open base to this server', 'kp.deleteBase': 'Delete knowledge base', 'kp.deleteBaseQ': 'Delete “{title}” from this browser? Download a project file first if you want to keep it.',
  'kp.notFoundBase': 'The knowledge base was not found.', 'kp.creating': 'Creating the knowledge base…', 'kp.created': 'Created “{title}”',
  'kp.importExists': 'Already here', 'kp.importExistsQ': '“{title}” is already in this browser. Replace it? (Cancel keeps both.)', 'kp.imported': 'Imported “{title}”', 'kp.importFailed': 'Import failed: {msg}',

  // server sync
  'kp.tokenTitle': 'Editing token', 'kp.tokenHint': 'The server prints its token when it starts (or set KP_TOKEN). It is kept in this browser.',
  'kp.tokenWrong': 'The server did not accept the token.', 'kp.retry': 'Retry', 'kp.conflict': 'The server has a newer version of this base.', 'kp.overwrite': 'Overwrite',
  'kp.syncFailed': 'Could not update the server: {msg}', 'kp.uploaded': 'Uploaded to the server',

  // block types (b.), descriptions (bd.), categories (c.)
  'c.text': 'Text', 'c.wiki': 'Encyclopedia', 'c.media': 'Media and pictures', 'c.language': 'Languages and parallel texts', 'c.nav': 'Navigation', 'c.layout': 'Layout',
  'b.text': 'Text', 'bd.text': 'Paragraphs, headings, lists, links, footnotes',
  'b.heading': 'Heading', 'bd.heading': 'A section heading (also in the contents)',
  'b.quote': 'Quotation', 'bd.quote': 'Block quote, pull quote or epigraph',
  'b.verse': 'Verse / lines', 'bd.verse': 'Poems, lyrics slots, lines with numbers and a parallel translation',
  'b.callout': 'Callout', 'bd.callout': 'Note, tip, warning, stub, spoiler box',
  'b.details': 'Collapsible', 'bd.details': 'A section the reader opens',
  'b.code': 'Code', 'bd.code': 'Preformatted text',
  'b.divider': 'Divider', 'bd.divider': 'Line, stars or space',
  'b.infobox': 'Infobox', 'bd.infobox': 'Summary box with a picture and key facts',
  'b.hatnote': 'Hatnote', 'bd.hatnote': '“Main article: …”, “For other uses, see …”',
  'b.toc': 'Table of contents', 'bd.toc': 'Place or float the contents',
  'b.references': 'References', 'bd.references': 'The list of footnotes and citations',
  'b.seealso': 'See also', 'bd.seealso': 'Related pages',
  'b.navbox': 'Navbox', 'bd.navbox': 'A navigation table shared by related pages',
  'b.disambig': 'Disambiguation', 'bd.disambig': 'Pages with the same name',
  'b.table': 'Table', 'bd.table': 'Rows and columns, sortable',
  'b.timeline': 'Timeline', 'bd.timeline': 'Dates and events',
  'b.pagelist': 'Page list', 'bd.pagelist': 'Children, a category, recent or chosen pages as a list or cards',
  'b.media': 'Picture / media', 'bd.media': 'Image, audio, video or file; left, right, centre, with text beside it; clickable',
  'b.gallery': 'Gallery', 'bd.gallery': 'Grid, packed rows or a slider',
  'b.diagram': 'Annotated picture', 'bd.diagram': 'Regions with leader lines to labels that link to pages; concept maps',
  'b.banner': 'Banner', 'bd.banner': 'A large picture with a title and a button',
  'b.interlinear': 'Interlinear text', 'bd.interlinear': 'Lines with transcription, glosses and translations as toggle layers; audio timestamps',
  'b.glossary': 'Glossary / vocabulary', 'bd.glossary': 'Terms with readings and meanings (table or cards)',
  'b.flashcards': 'Flash cards', 'bd.flashcards': 'Cards that turn over',
  'b.columns': 'Columns', 'bd.columns': 'Blocks side by side',

  // fields (f.)
  'f.align': 'Position', 'f.alt': 'Alternative text', 'f.anchor': 'Anchor', 'f.aspect': 'Proportions', 'f.audio': 'Audio', 'f.author': 'Author', 'f.back': 'Back side',
  'f.bg': 'Background', 'f.button': 'Button text', 'f.caption': 'Caption', 'f.category': 'Category', 'f.code': 'Code', 'f.collapsed': 'Collapsed', 'f.collapsible': 'Collapsible',
  'f.color': 'Colour', 'f.cols': 'Columns', 'f.compact': 'Compact', 'f.date': 'Date', 'f.depth': 'Levels', 'f.desc': 'Description', 'f.edges': 'Arrows', 'f.float': 'Float',
  'f.frame': 'Frame', 'f.from': 'From', 'f.front': 'Front side', 'f.group': 'Group', 'f.groups': 'Groups', 'f.h': 'Height', 'f.head': 'Header cells', 'f.header': 'Header row',
  'f.heading': 'With heading', 'f.id': 'Id', 'f.image': 'Image', 'f.intro': 'Introduction', 'f.items': 'Items', 'f.kind': 'Kind', 'f.label': 'Label', 'f.labels': 'Labels',
  'f.lang': 'Language code', 'f.layer': 'Layer', 'f.layout': 'Layout', 'f.level': 'Level', 'f.limit': 'At most', 'f.link': 'Link', 'f.links': 'Links', 'f.loop': 'Loop silently',
  'f.lx': 'Label x', 'f.ly': 'Label y', 'f.meaning': 'Meaning', 'f.meaningLayer': 'Meaning layer', 'f.media': 'File', 'f.note': 'Note', 'f.noteLayer': 'Note layer',
  'f.numbered': 'Numbered', 'f.numbers': 'Line numbers', 'f.open': 'Open', 'f.pts': 'Points', 'f.r': 'Radius', 'f.ratio': 'Proportions', 'f.reading': 'Reading',
  'f.readingLayer': 'Reading layer', 'f.rows': 'Rows', 'f.shape': 'Shape', 'f.size': 'Size', 'f.sort': 'Order', 'f.sortable': 'Sortable', 'f.source': 'Source',
  'f.striped': 'Striped', 'f.style': 'Style', 'f.subtitle': 'Subtitle', 'f.summary': 'Summary', 'f.t': 'Time (s)', 'f.term': 'Term', 'f.text': 'Text', 'f.tiers': 'Tiers (layers)',
  'f.title': 'Title', 'f.to': 'To', 'f.trLayer': 'Translation layer', 'f.translation': 'Translation', 'f.value': 'Value', 'f.w': 'Width', 'f.width': 'Width (px)', 'f.x': 'x', 'f.y': 'y',

  // options (o.; o.<field>.<value> where the generic word does not fit)
  'o.about': 'About (no prefix)', 'o.all': 'All', 'o.always': 'Always', 'o.arrow': 'Arrow', 'o.block': 'Block', 'o.border': 'Border', 'o.both': 'Both', 'o.cards': 'Cards',
  'o.category': 'Category', 'o.center': 'Centre', 'o.children': 'Child pages', 'o.circle': 'Circle', 'o.col': 'First column', 'o.columns': 'Columns', 'o.compact': 'Compact',
  'o.custom': 'Custom', 'o.dashed': 'Dashed', 'o.date': 'Date', 'o.epigraph': 'Epigraph', 'o.five': 'Every 5th line', 'o.float': 'Text around', 'o.full': 'Full width',
  'o.further': 'Further information', 'o.grid': 'Grid', 'o.hero': 'Lead story + cards', 'o.hover': 'On hover', 'o.important': 'Important', 'o.info': 'Information',
  'o.l': 'Large', 'o.left': 'Left', 'o.line': 'Line', 'o.links': 'Chosen pages', 'o.list': 'List', 'o.m': 'Medium', 'o.main': 'Main article', 'o.none': 'None', 'o.note': 'Note',
  'o.numbers': 'Numbers only', 'o.order': 'Page order', 'o.overlay': 'Text on the picture', 'o.packed': 'Packed rows', 'o.plain': 'Plain', 'o.point': 'Point', 'o.poly': 'Polygon',
  'o.pull': 'Pull quote', 'o.recent': 'Recent', 'o.rect': 'Rectangle', 'o.right': 'Right', 'o.row': 'First row', 'o.s': 'Small', 'o.see': 'See also', 'o.slider': 'Slider',
  'o.space': 'Space', 'o.split': 'Side by side', 'o.spoiler': 'Spoiler', 'o.stacked': 'Stacked', 'o.stars': 'Stars', 'o.stub': 'Stub', 'o.table': 'Table', 'o.thumb': 'Thumbnail frame',
  'o.tip': 'Tip', 'o.title': 'Title', 'o.warning': 'Warning',
  'o.numbers.all': 'Every line', 'o.source.all': 'All pages', 'o.labels.numbers': 'Numbers + legend', 'o.labels.always': 'Always', 'o.shape.none': 'Box (no region)',
  'o.toc.auto': 'Automatic', 'o.toc.on': 'Always', 'o.toc.off': 'Never', 'o.layout.default': 'Normal', 'o.layout.wide': 'Wide', 'o.layout.full': 'Full width',
};
