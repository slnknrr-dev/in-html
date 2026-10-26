// docs-app/viewer-dict.js - UI strings of the docs blocks in exported pages (table of contents, checklist, placeholders); the
// generic document strings come from paper/dict.js.
//
// Strings that end up inside exported pages (not the editor UI): they are embedded per document language, so a
// Georgian document shows Georgian "Contents" even when the editor UI is English.

const DOCS_UI = {
  en: {
    tocTitle: 'Contents',
    tocEmpty: 'Add headings: they appear here automatically.',
    taskDone: 'Done:',
    taskOpen: 'To do:',
    'ph.code': 'Paste or type code in the block settings',
    'ph.toc': 'Contents',
    'ph.task': 'Task',
  },
  ru: {
    tocTitle: 'Содержание',
    tocEmpty: 'Добавьте заголовки — они появятся здесь автоматически.',
    taskDone: 'Выполнено:',
    taskOpen: 'Не выполнено:',
    'ph.code': 'Вставьте или наберите код в настройках блока',
    'ph.toc': 'Содержание',
    'ph.task': 'Задача',
  },
  uk: {
    tocTitle: 'Зміст',
    tocEmpty: 'Додайте заголовки — вони з’являться тут автоматично.',
    taskDone: 'Виконано:',
    taskOpen: 'Не виконано:',
    'ph.code': 'Вставте або наберіть код у налаштуваннях блока',
    'ph.toc': 'Зміст',
    'ph.task': 'Завдання',
  },
  de: {
    tocTitle: 'Inhalt',
    tocEmpty: 'Fügen Sie Überschriften hinzu – sie erscheinen hier automatisch.',
    taskDone: 'Erledigt:',
    taskOpen: 'Offen:',
    'ph.code': 'Code in den Blockeinstellungen einfügen oder eingeben',
    'ph.toc': 'Inhalt',
    'ph.task': 'Aufgabe',
  },
  fr: {
    tocTitle: 'Sommaire',
    tocEmpty: 'Ajoutez des titres : ils apparaissent ici automatiquement.',
    taskDone: 'Fait :',
    taskOpen: 'À faire :',
    'ph.code': 'Collez ou saisissez le code dans les réglages du bloc',
    'ph.toc': 'Sommaire',
    'ph.task': 'Tâche',
  },
  es: {
    tocTitle: 'Índice',
    tocEmpty: 'Añada títulos: aparecerán aquí automáticamente.',
    taskDone: 'Hecho:',
    taskOpen: 'Pendiente:',
    'ph.code': 'Pegue o escriba el código en los ajustes del bloque',
    'ph.toc': 'Índice',
    'ph.task': 'Tarea',
  },
  ka: {
    tocTitle: 'სარჩევი',
    tocEmpty: 'დაამატეთ სათაურები — ისინი აქ ავტომატურად გამოჩნდება.',
    taskDone: 'შესრულებულია:',
    taskOpen: 'შესასრულებელია:',
    'ph.code': 'ჩასვით ან აკრიფეთ კოდი ბლოკის პარამეტრებში',
    'ph.toc': 'სარჩევი',
    'ph.task': 'დავალება',
  },
};

export {
  DOCS_UI
};
