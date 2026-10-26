// Development server for this application (sources import ../ libraries, so the repository root is served).
// import.meta.url identifies the app folder; ../server.js derives the root and the entry page from it, so every app
// starts the same way (node seo-kit/server.js). Not part of any build: the bundler ships only the pages.
import { serve } from '../server.js';

serve({ app: import.meta.url });
