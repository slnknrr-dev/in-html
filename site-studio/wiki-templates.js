// site-studio/wiki-templates.js - the templates of new knowledge bases, in picker order. Each module exports
// { id, icon, name: { lang: text }, desc: { lang: text }, spec({ lang }) } (kit.js builds the base from the spec).
import blank from './wiki-templates-blank.js';
import wiki from './wiki-templates-wiki.js';
import fandom from './wiki-templates-fandom.js';
import news from './wiki-templates-news.js';
import songs from './wiki-templates-songs.js';
import gaudiya from './wiki-templates-gaudiya.js';
import japanese from './wiki-templates-japanese.js';
import georgian from './wiki-templates-georgian.js';
import portal from './wiki-templates-portal.js';

// Array order = picker order (import order is irrelevant). blank is last on purpose: the showcases are what a new
// user should see first. All templates are static imports and ship in the bundle; acceptable because the picker
// previews them immediately.
export const TEMPLATES = [wiki, fandom, news, songs, gaudiya, japanese, georgian, portal, blank];
