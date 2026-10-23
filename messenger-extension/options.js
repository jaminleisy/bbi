const DEFAULTS = {
  apiBase: 'http://localhost:5000',
  botToken: ''
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
}

async function save() {
  const cfg = {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    botToken: $('botToken').value.trim()
  };
  await chrome.storage.sync.set(cfg);
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
