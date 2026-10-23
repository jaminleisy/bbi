// Runs in the page JS world so the messenger.com DevTools console can call
// __benbot_debug() without switching to the extension isolated world.
// Snapshot JSON is written by content.js into #__benbot_debug_json.

(() => {
  'use strict';
  window.__benbot_debug = () => {
    const el = document.getElementById('__benbot_debug_json');
    if (!el) return { error: 'content script has not published a snapshot yet — refresh this tab' };
    try { return JSON.parse(el.textContent || 'null'); }
    catch (e) { return { error: String(e) }; }
  };
})();
