const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return d.toLocaleTimeString();
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'get-state' }).catch(() => null);
  const cfg = await chrome.storage.sync.get(['apiBase']);
  $('server').textContent = cfg.apiBase || '(not set)';
  if (!state) {
    $('conn').textContent = 'worker asleep';
    $('conn').className = 'pill warn';
    return;
  }
  $('conn').textContent = state.connected ? 'connected' : 'disconnected';
  $('conn').className = 'pill ' + (state.connected ? 'ok' : 'err');
  $('lastIngest').textContent = fmtTime(state.lastIngest);
  $('lastPoll').textContent = fmtTime(state.lastPoll);
  $('pending').textContent = state.lastOutboxCount ?? '—';

  const log = state.log || [];
  $('log').innerHTML = log.slice(-8).reverse()
    .map(l => `<div>${new Date(l.ts).toLocaleTimeString()} — ${l.msg}</div>`)
    .join('');
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();
  $('sync').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'sync-now' });
    setTimeout(refresh, 500);
  });
  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
});
