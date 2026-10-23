// MV3 service worker — ingest-only. Scraped snapshots go to
// /api/messenger/ingest. The extension does not send replies.

const DEFAULTS = {
  apiBase: 'http://localhost:5000',
  botToken: ''
};

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function getState() {
  return await chrome.storage.session.get({
    connected: false,
    lastIngest: null,
    lastDebug: null,
    lastError: null,
    log: []
  });
}

async function setState(patch) {
  const cur = await getState();
  const next = { ...cur, ...patch };
  await chrome.storage.session.set(next);
  return next;
}

async function logLine(msg) {
  const cur = await getState();
  const log = [...(cur.log || []), { ts: new Date().toISOString(), msg }].slice(-40);
  await chrome.storage.session.set({ log });
  console.debug('[benbot-bridge]', msg);
}

function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function fetchJson(base, path, botToken, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Token': botToken,
      ...(init && init.headers)
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401
      ? ' — bot token does not match the server. Open Settings and paste Messenger:BotToken from the published app.'
      : res.status === 503
        ? ' — server has no Messenger:BotToken configured.'
        : '';
    throw new Error(`HTTP ${res.status} ${res.statusText}${hint} ${body}`.trim());
  }
  if (res.status === 204) return null;
  return res.json();
}

async function api(path, init) {
  const cfg = await getConfig();
  const base = normalizeBase(cfg.apiBase);
  if (!base || !cfg.botToken) {
    throw new Error('API base or bot token not configured. Open Settings.');
  }
  try {
    return await fetchJson(base, path, cfg.botToken, init);
  } catch (e) {
    if (base.startsWith('http://') && !/localhost|127\.0\.0\.1/i.test(base)) {
      const httpsBase = 'https://' + base.slice('http://'.length);
      return await fetchJson(httpsBase, path, cfg.botToken, init);
    }
    throw e;
  }
}

async function ping() {
  try {
    await api('/api/messenger/ping');
    await setState({ connected: true, lastError: null });
    return { ok: true };
  } catch (e) {
    await setState({ connected: false, lastError: e.message });
    await logLine('ping failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

function withoutAttachments(payload) {
  const messages = (payload?.messages || []).map((m) => ({ ...m, attachments: [] }));
  return { ...payload, messages };
}

async function postIngest(payload, scrape) {
  const result = await api('/api/messenger/ingest', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  await setState({
    connected: true,
    lastError: null,
    lastIngest: new Date().toISOString(),
    lastDebug: scrape || null
  });
  const name = payload?.counterpartyName || 'unknown';
  const scraped = scrape?.messageCount ?? payload?.messages?.length ?? 0;
  const rows = scrape?.rowCount ?? '?';
  if (result?.inserted > 0) {
    await logLine(`ingest: +${result.inserted} msgs (thread ${result.threadId}, ${name})`);
  } else {
    await logLine(`ingest: 0 new (thread ${result?.threadId ?? '?'}, ${name}, scraped ${scraped}/${rows} rows)`);
  }
  return { ok: true, result };
}

async function handleIngest(payload, scrape) {
  try {
    return await postIngest(payload, scrape);
  } catch (e) {
    const hasBytes = (payload?.messages || []).some((m) => (m.attachments || []).some((a) => a && a.dataBase64));
    if (hasBytes) {
      await logLine('ingest failed with images, retrying text-only: ' + e.message);
      try {
        return await postIngest(withoutAttachments(payload), scrape);
      } catch (e2) {
        await setState({ connected: false, lastError: e2.message });
        await logLine('ingest failed: ' + e2.message);
        return { ok: false, error: e2.message };
      }
    }
    await setState({ connected: false, lastError: e.message });
    await logLine('ingest failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

async function rescrapeOpenTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.messenger.com/*', 'https://www.facebook.com/messages/*']
  });
  if (!tabs[0]) {
    await logLine('no Messenger tab to scrape');
    return;
  }
  const snap = await chrome.tabs.sendMessage(tabs[0].id, { type: 'snapshot-now' }).catch(() => null);
  if (snap?._debug) await setState({ lastDebug: snap._debug });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'ingest') {
      sendResponse(await handleIngest(msg.payload, msg.scrape));
    } else if (msg?.type === 'sync-now') {
      await ping();
      await rescrapeOpenTab();
      sendResponse({ ok: true });
    } else if (msg?.type === 'get-state') {
      await ping();
      sendResponse(await getState());
    } else if (msg?.type === 'scrape-empty') {
      if (msg.scrape) await setState({ lastDebug: msg.scrape });
      await logLine('scrape found 0 messages — wait for the thread to finish loading, then Sync now');
      sendResponse({ ok: true });
    }
  })();
  return true;
});

ping().catch(() => {});
