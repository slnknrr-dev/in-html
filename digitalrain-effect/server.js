// Development server for this application: `node <app>/server.js [port]`.
// Why the repository root is served, not this folder: sources import shared libraries through ../ paths
// (../ui/ and the other library folders); serving only <app>/ would 404 every shared import. ../server.js mirrors the source tree
// 1:1 as unbundled ES modules, so devtools show real files and line numbers; the build (singlefile.js) is what
// removes the ../ dependency later.
// import.meta.url (not a hard-coded folder name): the shared server derives which app to open from this file's own
// location, so the instance survives renaming or copying the folder.
import { serve } from '../server.js';

serve({ app: import.meta.url });
