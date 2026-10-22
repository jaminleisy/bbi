// Settings page — reads/writes chrome.storage.sync and exercises /api/messenger/ping.

const DEFAULTS = {
  apiBase: 'http://localhost:5000',
  botToken: '',
  pollSeconds: 15,
  typeDelayMs: 40,
  sendJitterMs: 800
};

const $ = (id) => document.getElementById(id);

function showStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
  el.style.display = '';
}

async function load() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $('apiBase').value = cfg.apiBase;
  $('botToken').value = cfg.botToken;
  $('pollSeconds').value = cfg.pollSeconds;
  $('typeDelayMs').value = cfg.typeDelayMs;
  $('sendJitterMs').value = cfg.sendJitterMs;
}

async function save() {
  const cfg = {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    botToken: $('botToken').value.trim(),
    pollSeconds: Math.max(5, Number($('pollSeconds').value) || DEFAULTS.pollSeconds),
    typeDelayMs: Math.max(0, Number($('typeDelayMs').value) || DEFAULTS.typeDelayMs),
    sendJitterMs: Math.max(0, Number($('sendJitterMs').value) || DEFAULTS.sendJitterMs)
  };
  await chrome.storage.sync.set(cfg);
  // Nudge the service worker to reschedule its poll alarm with the new interval.
  try { await chrome.runtime.sendMessage({ type: 'config-updated' }); } catch { /* worker asleep */ }
  showStatus('Saved.', 'ok');
}

async function testConnection() {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const botToken = $('botToken').value.trim();
  if (!apiBase || !botToken) {
    showStatus('Fill in API base URL and bot token first.', 'err');
    return;
  }
  showStatus('Pinging ' + apiBase + '/api/messenger/ping …', 'info');
  try {
    const res = await fetch(apiBase + '/api/messenger/ping', {
      headers: { 'X-Bot-Token': botToken }
    });
    if (!res.ok) {
      showStatus(`HTTP ${res.status} ${res.statusText}`, 'err');
      return;
    }
    const body = await res.json();
    showStatus('OK — server time: ' + body.time, 'ok');
  } catch (e) {
    showStatus('Fetch failed: ' + e.message, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('save').addEventListener('click', save);
  $('test').addEventListener('click', testConnection);
});
