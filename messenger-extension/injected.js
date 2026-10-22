// Optional page-context helper. Not injected by default. If DOM scraping
// stops being reliable, load this from content.js via a <script> element
// so it runs in the page's own JS context (rather than the isolated
// content-script world) and hooks fetch/WebSocket for authoritative event
// data. Not needed for v1.

(() => {
  'use strict';
  // Intentionally empty — placeholder for the WebSocket/fetch hook upgrade.
})();
