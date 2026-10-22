// MV3 service worker — the extension's talking-to-the-server half.
//
// Responsibilities:
//   1. Receive scraped snapshots from content scripts and POST them to
//      /api/messenger/ingest.
//   2. Poll /api/messenger/outbox on a chrome.alarms schedule for queued
//      replies, then dispatch each reply to a messenger.com tab (opening
//      one if none is open).
//   3. Report progress back to the popup.
//
// The worker is unloaded aggressively by Chrome; keep all state in
// chrome.storage.session so it survives sleeps.

const DEFAULTS = {
  apiBase: 'http://localhost:5000',
  botToken: '',
  pollSeconds: 15,
  typeDelayMs: 40,
  sendJitterMs: 800
};

const ALARM_POLL = 'benbot-poll';

// ---------------------------------------------------------------------
//  Config helpers
// ---------------------------------------------------------------------

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function getState() {
  const s = await chrome.storage.session.get({
    connected: false,
    lastIngest: null,
    lastPoll: null,
    lastOutboxCount: 0,
    log: []
  });
  return s;
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

// ---------------------------------------------------------------------
//  Fetch helper
// ---------------------------------------------------------------------

async function api(path, init) {
  const cfg = await getConfig();
  if (!cfg.apiBase || !cfg.botToken) {
    throw new Error('API base or bot token not configured');
  }
  const res = await fetch(cfg.apiBase + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Token': cfg.botToken,
      ...(init && init.headers)
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------
//  Ingest (content -> server)
// ---------------------------------------------------------------------

async function handleIngest(payload) {
  try {
    const result = await api('/api/messenger/ingest', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    await setState({ connected: true, lastIngest: new Date().toISOString() });
    if (result?.inserted > 0) {
      await logLine(`ingest: +${result.inserted} msgs (thread ${result.threadId})`);
    }
    return { ok: true, result };
  } catch (e) {
    await setState({ connected: false });
    await logLine('ingest failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------
//  Outbox poll (server -> content)
// ---------------------------------------------------------------------

async function findMessengerTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.messenger.com/*' });
  return tabs[0] || null;
}

async function openMessengerTab(fbThreadId) {
  const url = `https://www.messenger.com/t/${encodeURIComponent(fbThreadId)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  // Wait for content script to load.
  await new Promise((r) => setTimeout(r, 4000));
  return tab;
}

async function dispatchReply(tabId, item, opts) {
  return await chrome.tabs.sendMessage(tabId, {
    type: 'send-reply',
    fbThreadId: item.fbThreadId,
    text: item.text,
    opts
  }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
}

async function pollOutboxOnce() {
  let items;
  try {
    items = await api('/api/messenger/outbox?limit=3');
  } catch (e) {
    await setState({ connected: false, lastPoll: new Date().toISOString() });
    await logLine('poll failed: ' + e.message);
    return;
  }
  await setState({
    connected: true,
    lastPoll: new Date().toISOString(),
    lastOutboxCount: items.length
  });

  if (items.length === 0) return;

  const cfg = await getConfig();
  const opts = { typeDelayMs: cfg.typeDelayMs, sendJitterMs: cfg.sendJitterMs };

  for (const item of items) {
    let tab = await findMessengerTab();
    if (!tab) tab = await openMessengerTab(item.fbThreadId);

    await logLine(`sending outbox #${item.id} → ${item.fbThreadId}`);
    const res = await dispatchReply(tab.id, item, opts);
    try {
      if (res && res.ok) {
        await api(`/api/messenger/outbox/${item.id}/ack`, {
          method: 'POST',
          body: JSON.stringify({ status: 'sent', externalId: res.externalId })
        });
        await logLine(`sent outbox #${item.id}`);
      } else {
        const err = res?.error || 'unknown error';
        // Retry unless attempts is already high.
        const status = (item.attempts ?? 0) >= 3 ? 'failed' : 'retry';
        await api(`/api/messenger/outbox/${item.id}/ack`, {
          method: 'POST',
          body: JSON.stringify({ status, error: err })
        });
        await logLine(`outbox #${item.id} ${status}: ${err}`);
      }
    } catch (e) {
      await logLine('ack failed: ' + e.message);
    }
    // Human-ish pause between multiple replies.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
  }
}

// ---------------------------------------------------------------------
//  Scheduling
// ---------------------------------------------------------------------

async function scheduleAlarm() {
  const cfg = await getConfig();
  const minutes = Math.max(cfg.pollSeconds / 60, 0.25); // alarms minimum 15s in MV3 unlocked
  await chrome.alarms.clear(ALARM_POLL);
  await chrome.alarms.create(ALARM_POLL, {
    delayInMinutes: minutes,
    periodInMinutes: minutes
  });
  await logLine(`poll every ${cfg.pollSeconds}s`);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) pollOutboxOnce();
});

chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => scheduleAlarm());

// ---------------------------------------------------------------------
//  Message router
// ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'ingest') {
      sendResponse(await handleIngest(msg.payload));
    } else if (msg?.type === 'sync-now') {
      await pollOutboxOnce();
      sendResponse({ ok: true });
    } else if (msg?.type === 'config-updated') {
      await scheduleAlarm();
      sendResponse({ ok: true });
    } else if (msg?.type === 'get-state') {
      sendResponse(await getState());
    }
  })();
  return true; // async
});

// Kick off an initial schedule attempt in case neither onInstalled nor
// onStartup fired since this SW came alive.
scheduleAlarm().catch(() => {});
