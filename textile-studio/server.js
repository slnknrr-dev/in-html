// textile-studio/server.js - development server for this application. The sources import sibling libraries by
// relative paths (../ui, ../garment, ../body ...), so the shared ../server.js serves the REPOSITORY ROOT and opens
// this app's folder; serving only textile-studio/ would 404 every ../ import. import.meta.url tells the shared
// server which app it was started for. Not used by the built pages (html@5_* folders are self-contained).
import { serve } from '../server.js';

serve({ app: import.meta.url });
