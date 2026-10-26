// knowledge-processor/templates.js - the templates of new knowledge bases, in picker order. Each module exports
// { id, icon, name: { lang: text }, desc: { lang: text }, spec({ lang }) } (kit.js builds the base from the spec).
import blank from './templates-blank.js';
import wiki from './templates-wiki.js';
import fandom from './templates-fandom.js';
import news from './templates-news.js';
import songs from './templates-songs.js';
import gaudiya from './templates-gaudiya.js';
import japanese from './templates-japanese.js';
import georgian from './templates-georgian.js';
import portal from './templates-portal.js';

// Array order = picker order: content-rich showcases first, blank last (it is the fallback, not the pitch). Adding a
// template means one import here; test.js iterates TEMPLATES, so a new one is tested automatically.
export const TEMPLATES = [wiki, fandom, news, songs, gaudiya, japanese, georgian, portal, blank];
