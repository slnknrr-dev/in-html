// knowledge-processor/strings-fr.js - editor strings, French (same keys as strings-en.js).
//
// Structure: one flat object, grouped by screen with '// section' comments in the same order as strings-en.js, so a
// side-by-side diff of two language files lines up. Keys are the contract: a missing key falls back to English at
// runtime (ui/i18n.js), which hides the gap, so keep the key set identical to strings-en.js. Plural values list only the
// categories French needs from Intl.PluralRules; 'other' must always be present as the final fallback.
export default {
  'app.name': 'Knowledge Processor',

  // shell
  'kp.bases': 'Bases de connaissances', 'kp.undo': 'Annuler', 'kp.redo': 'Rétablir', 'kp.togglePreview': 'Afficher ou masquer l’aperçu', 'kp.lockAll': 'Verrouiller de nouveau tout le contenu 451',
  'kp.export': 'Publier', 'kp.saving': 'Enregistrement…', 'kp.unsaved': 'Modifications non enregistrées', 'kp.saved': 'Enregistré', 'kp.saveFailed': 'Échec de l’enregistrement : {msg}',
  'kp.serverFailed': 'serveur non mis à jour', 'kp.onServer': 'sur le serveur', 'kp.noStorage': 'Ce navigateur n’autorise pas le stockage ici : les modifications ne sont conservées que jusqu’à la fermeture de l’onglet. Téléchargez un fichier de projet pour les garder.',
  'kp.pages': 'Pages', 'kp.page': 'Page', 'kp.media': 'Médias', 'kp.base': 'Base', 'kp.preview': 'Aperçu', 'kp.pageEditor': 'Éditeur de page', 'kp.panes': 'Panneaux',

  // pages
  'kp.pagesCount': { one: '{n} page', other: '{n} pages' }, 'kp.newPage': 'Nouvelle page', 'kp.newPageTitle': 'Nouvelle page', 'kp.secret': '451',
  'kp.filterPages': 'Filtrer les pages', 'kp.collapse': 'Replier', 'kp.expand': 'Déplier', 'kp.homePage': 'Page d’accueil', 'kp.secretPage': 'Page secrète (451)',
  'kp.hasVariants': { one: '{n} variante secrète', other: '{n} variantes secrètes' }, 'kp.versionsN': { one: '{n} version', other: '{n} versions' },
  'kp.hiddenPage': 'Non répertoriée', 'kp.redirect': 'Redirection', 'kp.open': 'Ouvrir', 'kp.rename': 'Renommer', 'kp.newChild': 'Nouvelle sous-page',
  'kp.newSecretChild': 'Nouvelle sous-page secrète', 'kp.moveTo': 'Déplacer vers…', 'kp.moveUp': 'Monter', 'kp.moveDown': 'Descendre', 'kp.makeHome': 'Définir comme page d’accueil',
  'kp.duplicate': 'Dupliquer', 'kp.makeSecret': 'Rendre secrète (451)', 'kp.makePublic': 'Rendre publique', 'kp.delete': 'Supprimer', 'kp.topLevel': '(niveau supérieur)',
  'kp.parentPage': 'Page parente', 'kp.move': 'Déplacer', 'kp.copySuffix': '(copie)', 'kp.cannotDuplicateSecret': 'Déverrouillez la page et rendez-la publique pour la dupliquer.',
  'kp.cannotDeleteHome': 'La page d’accueil ne peut pas être supprimée. Définissez d’abord une autre page comme page d’accueil.', 'kp.deletePage': 'Supprimer la page',
  'kp.deletePageQ': 'Supprimer « {title} » ?', 'kp.deletePageKids': { one: 'Supprimer « {title} » ? Sa sous-page ({n}) remonte d’un niveau.', other: 'Supprimer « {title} » ? Ses {n} sous-pages remontent d’un niveau.' },
  'kp.pageTitle': 'Titre', 'kp.noPage': 'Aucune page sélectionnée.',

  // page editor
  'kp.pageActions': 'Actions sur la page', 'kp.more': 'Plus', 'kp.pageSettings': 'Paramètres de la page', 'kp.slug': 'Adresse', 'kp.slugHint': 'Partie de l’URL : lettres de toute écriture, chiffres, « - » et « / » pour les pages imbriquées.',
  'kp.slugHome': 'La page d’accueil est publiée à la racine du site ; l’adresse sert pour les liens.', 'kp.slugFromTitle': 'Créer l’adresse à partir du titre', 'kp.fromTitle': 'Depuis le titre',
  'kp.displayTitle': 'Titre affiché', 'kp.displayHint': 'Facultatif : un titre avec balisage (italique, ruby) affiché à la place du titre simple.',
  'kp.categories': 'Catégories', 'kp.category': 'catégorie', 'kp.newCategory': 'Nouvelle catégorie', 'kp.categoryName': 'Nom de la catégorie',
  'kp.summary': 'Résumé', 'kp.summaryHint': 'Affiché dans les aperçus au survol, les cartes et les résultats de recherche (sinon le premier paragraphe).', 'kp.image': 'Image', 'kp.imageHint': 'Pour les aperçus et les cartes (sinon la première image de la page).',
  'kp.date': 'Date', 'kp.author': 'Auteur', 'kp.toc': 'Sommaire', 'kp.layout': 'Largeur', 'kp.hiddenHint': 'Absente des listes, de la page au hasard et de la recherche ; accessible par les liens.',
  'kp.redirectTarget': 'Rediriger vers', 'kp.pageLayers': 'Couches de cette page', 'kp.pageLayersHint': 'Bascules propres à cette page (les couches de la base sont dans les paramètres de la base).',
  'kp.newLayer': 'Nouvelle couche', 'kp.layerName': 'Nom de la couche', 'kp.onByDefault': 'affichée par défaut', 'kp.remove': 'Retirer',
  'kp.variants': 'Variantes', 'kp.publicVersion': 'Publique', 'kp.secretVersion': 'Version secrète', 'kp.newVariant': 'Variante secrète', 'kp.newVariantHint': 'Une alternative de cette page qui ne s’ouvre qu’avec un mot de passe (#?451=…)',
  'kp.renameVariant': 'Renommer la variante', 'kp.variantLabel': 'Nom de la variante', 'kp.changePassword': 'Changer le mot de passe', 'kp.lock': 'Verrouiller', 'kp.deleteVariant': 'Supprimer la variante secrète',
  'kp.deleteVariantQ': 'Supprimer cette variante secrète ? Son contenu sera perdu.', 'kp.versions': 'Versions', 'kp.mainVersion': 'Version principale', 'kp.versionN': 'Version {n}',
  'kp.newVersion': 'Version', 'kp.newVersionHint': 'Une autre version de la page (p. ex. « simplifiée ») ; les lecteurs passent d’une version à l’autre', 'kp.simpler': 'Simplifiée', 'kp.fullVersion': 'Détaillée',
  'kp.versionHint': 'Les versions sont des textes alternatifs d’une même page — par exemple une détaillée et une simplifiée. Autant que vous voulez, avec les noms de votre choix.',
  'kp.versionLabel': 'Nom de la version', 'kp.versionCopy': 'Partir d’une copie de la version actuelle', 'kp.add': 'Ajouter', 'kp.renameVersion': 'Renommer la version',
  'kp.moveLeft': 'Déplacer à gauche', 'kp.moveRight': 'Déplacer à droite', 'kp.deleteVersion': 'Supprimer la version', 'kp.deleteVersionQ': 'Supprimer la version « {name} » ?',
  'kp.whatLinksHere': 'Pages liées', 'kp.noBacklinks': 'Aucune page ne pointe encore ici.',
  'kp.lockedPage': 'Cette page est chiffrée', 'kp.lockedVariant': 'Cette variante est chiffrée', 'kp.lockedHint': 'Saisissez son mot de passe pour la modifier. Le mot de passe n’est pas conservé ; le contenu n’est déchiffré que dans cet onglet.',
  'kp.backToPublic': 'Version publique', 'kp.secretPageEditing': 'Page secrète : tout ici est scellé par son mot de passe ; sans lui, l’adresse renvoie une simple erreur 404.',
  'kp.variantEditing': 'Variante secrète : les lecteurs sans mot de passe voient la version publique ; avec #?451=motdepasse, ils peuvent passer à celle-ci.',

  // blocks
  'kp.addBlock': 'Ajouter un bloc', 'kp.insertHere': 'Insérer un bloc ici', 'kp.hidden': 'masqué', 'kp.edit': 'Modifier', 'kp.show': 'Afficher', 'kp.hide': 'Masquer',
  'kp.blockLayer': 'Affiché avec la couche', 'kp.noLayer': '(toujours affiché)', 'kp.noLayersYet': 'Pas encore de couches : ajoutez-en dans les paramètres de la base ou de la page.',
  'kp.addItem': 'Ajouter un élément', 'kp.item': 'Élément', 'kp.columnN': 'Colonne {n}', 'kp.row': 'Ligne', 'kp.column': 'Colonne',
  'kp.tiersHint': 'Choisissez d’abord les niveaux (couches) du bloc.', 'kp.tiersPick': 'Chaque couche choisie est une ligne sous l’original (transcription, glose, traduction…).',
  'kp.ptsHint': 'Points : {n} (à modifier dans l’éditeur de schéma)', 'kp.editDiagram': 'Modifier l’image et les zones', 'kp.diagramHint': 'Dessinez des zones sur l’image, faites glisser les étiquettes pour placer leurs lignes de rappel, liez les zones à des pages.',
  'kp.linkPh': 'page, page#section ou https://…', 'kp.color': 'Couleur', 'kp.clear': 'Effacer', 'kp.format': 'Mise en forme',
  'kp.mk.bold': 'Gras (Ctrl+B)', 'kp.mk.italic': 'Italique (Ctrl+I)', 'kp.mk.link': 'Lien vers une page (Ctrl+K)', 'kp.mk.heading': 'Titre', 'kp.mk.list': 'Liste',
  'kp.mk.quote': 'Citation', 'kp.mk.ref': 'Note de bas de page', 'kp.mk.cite': 'Référence', 'kp.mk.layer': 'Texte d’une couche', 'kp.mk.tip': 'Infobulle', 'kp.mk.ph': 'Espace réservé à remplir', 'kp.mk.code': 'Code',

  // media
  'kp.addFiles': 'Ajouter des fichiers (ou les déposer ici)', 'kp.upload': 'Importer des fichiers', 'kp.mediaCount': { one: '{n} fichier', other: '{n} fichiers' }, 'kp.noMedia': 'Pas encore de fichiers.',
  'kp.mediaItem': 'Fichier', 'kp.name': 'Nom', 'kp.alt': 'Texte alternatif', 'kp.altHint': 'Ce que montre l’image, pour les lecteurs d’écran et au cas où elle ne se charge pas.',
  'kp.credit': 'Crédit / source', 'kp.secretMedia': 'Uniquement dans le contenu 451', 'kp.secretMediaHint': 'Jamais publié en clair : le fichier voyage chiffré à l’intérieur des pages secrètes qui l’utilisent.',
  'kp.usedOn': 'Utilisé sur : {list}', 'kp.unused': 'Utilisé sur aucune page publique.', 'kp.replace': 'Remplacer', 'kp.replaced': 'Fichier remplacé', 'kp.copyMarkup': 'Copier le balisage du lien',
  'kp.copied': 'Copié', 'kp.deleteMedia': 'Supprimer le fichier', 'kp.deleteMediaQ': 'Supprimer ce fichier ?', 'kp.deleteMediaUsed': 'Ce fichier est utilisé sur : {list}. Le supprimer quand même ?',
  'kp.properties': 'Propriétés', 'kp.choose': 'Choisir…', 'kp.chooseMedia': 'Choisir un fichier', 'kp.noFile': 'Aucun fichier', 'kp.logo': 'Logo',

  // diagram editor
  'kp.dg.select': 'Sélectionner / déplacer', 'kp.dg.point': 'Point', 'kp.dg.rect': 'Rectangle', 'kp.dg.circle': 'Cercle', 'kp.dg.poly': 'Polygone', 'kp.dg.node': 'Boîte (carte conceptuelle)',
  'kp.dg.help.select': 'Faites glisser les zones pour les déplacer et les étiquettes pour les placer (la ligne de rappel suit) ; les flèches ajustent, Suppr efface.',
  'kp.dg.help.point': 'Cliquez sur l’image pour placer un point.', 'kp.dg.help.rect': 'Faites glisser sur l’image pour dessiner un rectangle.', 'kp.dg.help.circle': 'Faites glisser depuis le centre pour dessiner un cercle.',
  'kp.dg.help.poly': 'Cliquez sur les sommets ; double-clic ou Entrée pour terminer.', 'kp.dg.help.none': 'Cliquez pour placer une boîte étiquetée (un nœud de carte conceptuelle).',
  'kp.dg.picture': 'Image et apparence', 'kp.dg.noPicture': 'Aucune image', 'kp.dg.region': 'Zone {n}', 'kp.dg.labelOnRegion': 'Étiquette sur la zone',
  'kp.dg.empty': 'Choisissez un outil ci-dessus et dessinez sur l’image.', 'kp.dg.arrows': 'Flèches ({n})', 'kp.dg.addArrow': 'Ajouter une flèche', 'kp.apply': 'Appliquer',

  // 451
  'kp.deriving': 'Traitement du mot de passe…', 'kp.derivingHint': 'La clé est dérivée du mot de passe par une fonction volontairement lente, ce qui ralentit aussi les tentatives de devinette.',
  'kp.password': 'Mot de passe', 'kp.passwordAgain': 'Répétez le mot de passe', 'kp.showPassword': 'Afficher le mot de passe', 'kp.passwordEmpty': 'Saisissez un mot de passe.', 'kp.passwordMismatch': 'Les mots de passe diffèrent.',
  'kp.passwordHint': 'Les lecteurs ouvrent ce contenu avec #?451=motdepasse à la fin de l’adresse ou sur la page « Déverrouiller ». Un mot de passe perdu ne peut pas être récupéré.',
  'kp.unlockTitle': 'Déverrouiller le contenu 451', 'kp.unlock': 'Déverrouiller', 'kp.unlockWrong': 'Ce mot de passe n’ouvre rien dans cette base.', 'kp.unlockedN': { one: 'Déverrouillé : {n} élément', other: 'Déverrouillés : {n} éléments' },
  'kp.secretPageTitle': 'Page secrète', 'kp.notePh': 'visible par vous seul, p. ex. « brouillon pour l’équipe »', 'kp.newSecretPage': 'Nouvelle page secrète (451)',
  'kp.secretPageHint': 'Une page secrète n’existe pas pour les lecteurs sans mot de passe (simple erreur 404) ; son adresse, son titre et son texte sont chiffrés.',
  'kp.editorNote': 'Note dans l’éditeur', 'kp.newVariant2': 'Nouvelle variante secrète', 'kp.variantHint': 'Les lecteurs sans mot de passe voient la page publique ; avec celui-ci, ils peuvent passer à cette variante. Elle peut avoir ses propres versions.',
  'kp.variantCopy': 'Partir d’une copie de la page publique', 'kp.passwordChanged': 'Mot de passe changé', 'kp.homeCannotBeSecret': 'La page d’accueil ne peut pas être secrète.',
  'kp.makeSecretDropsVariants': 'Les variantes secrètes de cette page sont supprimées quand la page entière devient secrète. Continuer ?',
  'kp.unlockFirst': 'Déverrouillez d’abord la page.', 'kp.makePublicQ': 'Publier cette page en clair ? Son contenu sera lisible par tous.',

  // base settings
  'kp.general': 'Général', 'kp.baseTitle': 'Titre', 'kp.tagline': 'Slogan', 'kp.contentLang': 'Langue du contenu', 'kp.contentLangHint': 'Sert à la césure, au tri, aux dates et à la recherche.',
  'kp.readerLang': 'Langue de l’interface de lecture', 'kp.readerLangHint': 'Boutons, « Sommaire », « Références », recherche et textes 404 de la base publiée.',
  'kp.look': 'Apparence', 'kp.theme': 'Thème', 'kp.accent': 'Couleur d’accent', 'kp.accentHint': 'Liens, boutons et mises en évidence (vide : la couleur du thème).',
  'kp.navigation': 'Navigation supérieure', 'kp.navHint': 'Liens de l’en-tête et du menu latéral : une adresse de page, [[category:…]] ou https://…', 'kp.label': 'Libellé', 'kp.addLink': 'Ajouter un lien',
  'kp.footer': 'Pied de page', 'kp.footerText': 'Texte du pied de page', 'kp.license': 'Ligne de licence', 'kp.layers': 'Couches (bascules)',
  'kp.layersHint': 'Les couches sont des parties de pages que les lecteurs affichent ou masquent avec des boutons : transcription, traductions, gloses, commentaires… Associez une couche à des blocs ou à du texte.',
  'kp.rubyLayer': 'Couche des furigana / ruby', 'kp.rubyHint': 'Le texte ruby écrit sous la forme {base|reading} appartient à cette couche.',
  'kp.features': 'Fonctions de lecture', 'kp.security': 'Chiffrement 451', 'kp.kdf': 'Dérivation de clé',
  'kp.kdfHint': 'Les enveloppes sont chiffrées en AES-256-GCM avec une clé dérivée du mot de passe. Les changements s’appliquent au contenu scellé à partir de maintenant ; les enveloppes existantes gardent leurs paramètres.',
  'kp.kdfT': 'Passes (Argon2id t)', 'kp.kdfM': 'Mémoire, Kio (Argon2id m)', 'kp.kdfI': 'Itérations (PBKDF2)',
  'theme.encyclopedia': 'Encyclopédie', 'theme.fandom-dark': 'Fandom (sombre)', 'theme.magazine': 'Magazine', 'theme.minimal': 'Minimal', 'theme.scholarly': 'Universitaire',
  'set.search': 'Recherche', 'set.previews': 'Aperçus des liens au survol', 'set.recent': 'Modifications récentes', 'set.random': 'Page au hasard', 'set.allPages': 'Toutes les pages',
  'set.backlinks': 'Pages liées', 'set.crumbs': 'Fil d’Ariane', 'set.unlock': 'Page « Déverrouiller » (451)', 'set.subpages': 'Sous-pages sous les articles', 'set.schemeToggle': 'Bascule clair / sombre',
  'set.footerInfo': 'Ligne « Réalisé avec »', 'set.lastEdited': 'Date de dernière modification', 'set.numbered': 'Sommaire numéroté', 'set.toc': 'Sommaire', 'set.tocMin': 'Sommaire automatique à partir de ce nombre de titres',

  // preview
  'kp.addressHint': 'L’adresse de cette page dans le mode de publication choisi', 'kp.back': 'Retour', 'kp.previewMode': 'Mode de publication',
  'kp.mode.single': 'Fichier unique', 'kp.mode.static': 'Site statique', 'kp.mode.server': 'Serveur', 'kp.device': 'Largeur', 'kp.dev.desktop': 'Ordinateur', 'kp.dev.tablet': 'Tablette', 'kp.dev.phone': 'Téléphone',
  'kp.openTab': 'Ouvrir la version en un seul fichier dans un nouvel onglet', 'kp.previewUnavailable': 'L’aperçu nécessite le module de lecture, absent de cette copie.', 'kp.popupBlocked': 'Le navigateur a bloqué le nouvel onglet.',
  'kp.openHere': 'Ouvrir dans l’aperçu', 'kp.editPage': 'Modifier la page', 'kp.createPage': 'Créer cette page', 'kp.copyLink': 'Copier le balisage du lien',

  // publishing
  'kp.exportTitle': 'Publier', 'kp.exportSealed': { one: '{n} élément de contenu 451 est verrouillé dans l’éditeur : il est publié scellé, tel quel.', other: '{n} éléments de contenu 451 sont verrouillés dans l’éditeur : ils sont publiés scellés, tels quels.' },
  'kp.exportSealedAll': 'Le contenu 451 est toujours publié chiffré ; seules les enveloppes quittent l’éditeur.', 'kp.download': 'Télécharger',
  'kp.ex.single': 'Un fichier HTML', 'kp.ex.singleHint': 'Toutes les pages, les images et le lecteur dans un seul fichier qui fonctionne hors ligne et depuis le disque ; les pages sont des #/adresses.',
  'kp.ex.static': 'Site statique', 'kp.ex.staticHint': 'Un fichier par page (moteurs de recherche, lecteurs sans JS) et un 404.html qui sert les pages virtuelles : GitHub / Codeberg Pages, Netlify, tout hébergeur statique.',
  'kp.ex.server': 'Serveur (Node.js)', 'kp.ex.serverHint': 'server.mjs pour Node 18+ : vraies adresses, statut 404 pour les pages inconnues et une API d’édition avec jeton.',
  'kp.ex.project': 'Fichier de projet', 'kp.ex.projectHint': 'Toute la base avec ses fichiers, pour continuer dans un autre navigateur ou garder une sauvegarde (à importer dans « Bases de connaissances »).',
  'kp.ex.publish': 'Publier sur un serveur', 'kp.ex.publishHint': 'Envoyer la base à un serveur en marche issu de l’export « Serveur » (via son API d’édition).',
  'kp.ex.hosted': 'Publié ici', 'kp.ex.hostedHint': 'Ce serveur publie la base à l’adresse :', 'kp.urlStyle': 'Adresses', 'kp.urlStyleHint': 'propres : /page · dossiers : /page/ · html : /page.html (fonctionne aussi depuis un dossier sur le disque)',
  'kp.style.clean': 'Propres (/page)', 'kp.style.folders': 'Dossiers (/page/)', 'kp.style.html': 'Fichiers .html (/page.html)',
  'kp.basePath': 'Chemin de base', 'kp.basePathHint': 'Facultatif : le dossier d’un site de projet, p. ex. /repository/ (détecté automatiquement si vide).',
  'kp.siteURL': 'Adresse du site', 'kp.siteURLHint': 'Facultatif : l’adresse complète pour sitemap.xml et robots.txt.', 'kp.serverURL': 'Adresse du serveur', 'kp.token': 'Jeton',
  'kp.serverURLMissing': 'Saisissez l’adresse du serveur.', 'kp.publish': 'Publier', 'kp.published': 'Publié', 'kp.openSite': 'Ouvrir le site',
  'kp.exporting': 'Préparation : {what}…', 'kp.exportFailed': 'Échec de la publication : {msg}',

  // bases
  'kp.inBrowser': 'Dans ce navigateur', 'kp.newBase': 'Nouvelle base de connaissances à partir d’un modèle', 'kp.import': 'Importer un fichier de projet (.zip / .json)', 'kp.onServerTitle': 'Sur ce serveur',
  'kp.loading': 'Chargement…', 'kp.uploadToServer': 'Envoyer la base ouverte sur ce serveur', 'kp.deleteBase': 'Supprimer la base de connaissances', 'kp.deleteBaseQ': 'Supprimer « {title} » de ce navigateur ? Téléchargez d’abord un fichier de projet si vous voulez la conserver.',
  'kp.notFoundBase': 'Base de connaissances introuvable.', 'kp.creating': 'Création de la base de connaissances…', 'kp.created': '« {title} » créée',
  'kp.importExists': 'Déjà présente', 'kp.importExistsQ': '« {title} » est déjà dans ce navigateur. La remplacer ? (Annuler garde les deux.)', 'kp.imported': '« {title} » importée', 'kp.importFailed': 'Échec de l’importation : {msg}',

  // server sync
  'kp.tokenTitle': 'Jeton d’édition', 'kp.tokenHint': 'Le serveur affiche son jeton au démarrage (ou définissez KP_TOKEN). Il est conservé dans ce navigateur.',
  'kp.tokenWrong': 'Le serveur n’a pas accepté le jeton.', 'kp.retry': 'Réessayer', 'kp.conflict': 'Le serveur a une version plus récente de cette base.', 'kp.overwrite': 'Écraser',
  'kp.syncFailed': 'Impossible de mettre à jour le serveur : {msg}', 'kp.uploaded': 'Envoyé sur le serveur',

  // block types (b.), descriptions (bd.), categories (c.)
  'c.text': 'Texte', 'c.wiki': 'Encyclopédie', 'c.media': 'Médias et images', 'c.language': 'Langues et textes parallèles', 'c.nav': 'Navigation', 'c.layout': 'Mise en page',
  'b.text': 'Texte', 'bd.text': 'Paragraphes, titres, listes, liens, notes',
  'b.heading': 'Titre', 'bd.heading': 'Un titre de section (repris dans le sommaire)',
  'b.quote': 'Citation', 'bd.quote': 'Citation en bloc, en exergue ou épigraphe',
  'b.verse': 'Vers / lignes', 'bd.verse': 'Poèmes, paroles, lignes numérotées et traduction en regard',
  'b.callout': 'Encadré', 'bd.callout': 'Remarque, astuce, avertissement, ébauche, divulgâcheur',
  'b.details': 'Repliable', 'bd.details': 'Une section que le lecteur déplie',
  'b.code': 'Code', 'bd.code': 'Texte préformaté',
  'b.divider': 'Séparateur', 'bd.divider': 'Ligne, étoiles ou espace',
  'b.infobox': 'Infobox', 'bd.infobox': 'Encadré de synthèse avec une image et les faits clés',
  'b.hatnote': 'Note d’en-tête', 'bd.hatnote': '« Article principal : … », « Pour les articles homonymes, voir … »',
  'b.toc': 'Sommaire', 'bd.toc': 'Placer le sommaire ou le faire flotter',
  'b.references': 'Références', 'bd.references': 'La liste des notes et des références',
  'b.seealso': 'Voir aussi', 'bd.seealso': 'Pages connexes',
  'b.navbox': 'Palette de navigation', 'bd.navbox': 'Un tableau de navigation commun à des pages liées',
  'b.disambig': 'Homonymie', 'bd.disambig': 'Pages portant le même nom',
  'b.table': 'Tableau', 'bd.table': 'Lignes et colonnes, triables',
  'b.timeline': 'Chronologie', 'bd.timeline': 'Dates et événements',
  'b.pagelist': 'Liste de pages', 'bd.pagelist': 'Sous-pages, une catégorie, pages récentes ou choisies, en liste ou en cartes',
  'b.media': 'Image / média', 'bd.media': 'Image, audio, vidéo ou fichier ; à gauche, à droite, centré, avec du texte à côté ; cliquable',
  'b.gallery': 'Galerie', 'bd.gallery': 'Grille, rangées serrées ou diaporama',
  'b.diagram': 'Image annotée', 'bd.diagram': 'Zones reliées par des lignes de rappel à des étiquettes qui mènent à des pages ; cartes conceptuelles',
  'b.banner': 'Bannière', 'bd.banner': 'Une grande image avec un titre et un bouton',
  'b.interlinear': 'Texte interlinéaire', 'bd.interlinear': 'Lignes avec transcription, gloses et traductions en couches activables ; repères temporels audio',
  'b.glossary': 'Glossaire / vocabulaire', 'bd.glossary': 'Termes avec lectures et sens (tableau ou cartes)',
  'b.flashcards': 'Cartes mémoire', 'bd.flashcards': 'Cartes qui se retournent',
  'b.columns': 'Colonnes', 'bd.columns': 'Blocs côte à côte',

  // fields (f.)
  'f.align': 'Position', 'f.alt': 'Texte alternatif', 'f.anchor': 'Ancre', 'f.aspect': 'Proportions', 'f.audio': 'Audio', 'f.author': 'Auteur', 'f.back': 'Verso',
  'f.bg': 'Arrière-plan', 'f.button': 'Texte du bouton', 'f.caption': 'Légende', 'f.category': 'Catégorie', 'f.code': 'Code', 'f.collapsed': 'Replié', 'f.collapsible': 'Repliable',
  'f.color': 'Couleur', 'f.cols': 'Colonnes', 'f.compact': 'Compact', 'f.date': 'Date', 'f.depth': 'Niveaux', 'f.desc': 'Description', 'f.edges': 'Flèches', 'f.float': 'Flottant',
  'f.frame': 'Cadre', 'f.from': 'De', 'f.front': 'Recto', 'f.group': 'Groupe', 'f.groups': 'Groupes', 'f.h': 'Hauteur', 'f.head': 'Cellules d’en-tête', 'f.header': 'Ligne d’en-tête',
  'f.heading': 'Avec titre', 'f.id': 'Id', 'f.image': 'Image', 'f.intro': 'Introduction', 'f.items': 'Éléments', 'f.kind': 'Type', 'f.label': 'Étiquette', 'f.labels': 'Étiquettes',
  'f.lang': 'Code de langue', 'f.layer': 'Couche', 'f.layout': 'Disposition', 'f.level': 'Niveau', 'f.limit': 'Au plus', 'f.link': 'Lien', 'f.links': 'Liens', 'f.loop': 'Boucle silencieuse',
  'f.lx': 'Étiquette x', 'f.ly': 'Étiquette y', 'f.meaning': 'Sens', 'f.meaningLayer': 'Couche du sens', 'f.media': 'Fichier', 'f.note': 'Remarque', 'f.noteLayer': 'Couche des remarques',
  'f.numbered': 'Numéroté', 'f.numbers': 'Numéros de ligne', 'f.open': 'Ouvert', 'f.pts': 'Points', 'f.r': 'Rayon', 'f.ratio': 'Proportions', 'f.reading': 'Lecture',
  'f.readingLayer': 'Couche de lecture', 'f.rows': 'Lignes', 'f.shape': 'Forme', 'f.size': 'Taille', 'f.sort': 'Ordre', 'f.sortable': 'Triable', 'f.source': 'Source',
  'f.striped': 'Lignes alternées', 'f.style': 'Style', 'f.subtitle': 'Sous-titre', 'f.summary': 'Résumé', 'f.t': 'Temps (s)', 'f.term': 'Terme', 'f.text': 'Texte', 'f.tiers': 'Niveaux (couches)',
  'f.title': 'Titre', 'f.to': 'Vers', 'f.trLayer': 'Couche de traduction', 'f.translation': 'Traduction', 'f.value': 'Valeur', 'f.w': 'Largeur', 'f.width': 'Largeur (px)', 'f.x': 'x', 'f.y': 'y',

  // options (o.; o.<field>.<value> where the generic word does not fit)
  'o.about': 'À propos (sans préfixe)', 'o.all': 'Tout', 'o.always': 'Toujours', 'o.arrow': 'Flèche', 'o.block': 'Bloc', 'o.border': 'Bordure', 'o.both': 'Les deux', 'o.cards': 'Cartes',
  'o.category': 'Catégorie', 'o.center': 'Centré', 'o.children': 'Sous-pages', 'o.circle': 'Cercle', 'o.col': 'Première colonne', 'o.columns': 'Colonnes', 'o.compact': 'Compact',
  'o.custom': 'Personnalisé', 'o.dashed': 'Tirets', 'o.date': 'Date', 'o.epigraph': 'Épigraphe', 'o.five': 'Toutes les 5 lignes', 'o.float': 'Texte autour', 'o.full': 'Pleine largeur',
  'o.further': 'Pour plus de détails', 'o.grid': 'Grille', 'o.hero': 'À la une + cartes', 'o.hover': 'Au survol', 'o.important': 'Important', 'o.info': 'Information',
  'o.l': 'Grand', 'o.left': 'Gauche', 'o.line': 'Ligne', 'o.links': 'Pages choisies', 'o.list': 'Liste', 'o.m': 'Moyen', 'o.main': 'Article principal', 'o.none': 'Aucun', 'o.note': 'Remarque',
  'o.numbers': 'Numéros seuls', 'o.order': 'Ordre des pages', 'o.overlay': 'Texte sur l’image', 'o.packed': 'Rangées serrées', 'o.plain': 'Simple', 'o.point': 'Point', 'o.poly': 'Polygone',
  'o.pull': 'Citation en exergue', 'o.recent': 'Récentes', 'o.rect': 'Rectangle', 'o.right': 'Droite', 'o.row': 'Première ligne', 'o.s': 'Petit', 'o.see': 'Voir aussi', 'o.slider': 'Diaporama',
  'o.space': 'Espace', 'o.split': 'Côte à côte', 'o.spoiler': 'Divulgâcheur', 'o.stacked': 'Empilé', 'o.stars': 'Étoiles', 'o.stub': 'Ébauche', 'o.table': 'Tableau', 'o.thumb': 'Cadre de vignette',
  'o.tip': 'Astuce', 'o.title': 'Titre', 'o.warning': 'Avertissement',
  'o.numbers.all': 'Chaque ligne', 'o.source.all': 'Toutes les pages', 'o.labels.numbers': 'Numéros + légende', 'o.labels.always': 'Toujours', 'o.shape.none': 'Boîte (sans zone)',
  'o.toc.auto': 'Automatique', 'o.toc.on': 'Toujours', 'o.toc.off': 'Jamais', 'o.layout.default': 'Normale', 'o.layout.wide': 'Large', 'o.layout.full': 'Pleine largeur',
};
