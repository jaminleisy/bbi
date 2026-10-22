// Content script for messenger.com — scrapes the currently open thread and
// executes reply commands dispatched by the background service worker.
//
// FB rewrites CSS class names constantly, so this file targets stable
// affordances: ARIA roles, aria-label text, dir="auto" bubbles, and URL
// patterns. When something breaks, adjust the SELECTORS block at the top.
//
// Debug tip: from the messenger.com console run
//     __benbot_debug()
// to see the last snapshot the observer built.

(() => {
  'use strict';

  // -----------------------------------------------------------------
  // Selectors — the small blast radius when FB reshuffles DOM
  // -----------------------------------------------------------------
  const SELECTORS = {
    // Currently-open thread container. On messenger.com this scrolls to the
    // right of the sidebar. The outer <main> is stable; message rows are
    // aria-role="row" inside role="grid".
    threadRegion: 'div[role="main"]',
    messageGrid: 'div[role="grid"]',
    messageRow:  'div[role="row"]',
    // Text bubbles are marked with dir="auto". Multiple can appear per row
    // (name, timestamp, body). We take the longest textual candidate.
    textCandidate: 'div[dir="auto"]',
    // Compose area (rich contenteditable).
    composer: 'div[role="textbox"][contenteditable="true"]',
    // Header showing counterparty name + listing title. Marketplace threads
    // put the listing card inside role="complementary".
    header: 'div[role="banner"], header',
    marketplaceCard: 'a[href*="/marketplace/item/"]',
    // Image attachments inside a message. Filter to fbcdn hosts and avoid
    // tiny avatars/emoji (see minAttachmentPx below).
    attachmentImg: 'img[src*="fbcdn.net"], img[src*="cdninstagram.com"]'
  };

  // Skip anything smaller than this — avatars, sticker thumbnails, emoji.
  const MIN_ATTACHMENT_PX = 60;
  // Extension will cap outgoing payload size to keep ingest responsive.
  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
  const MAX_ATTACHMENTS_PER_MESSAGE = 5;

  const state = {
    lastPathname: '',
    lastFbThreadId: null,
    seen: new Set(),          // ExternalIds we've already reported this session
    fetchedImgSrcs: new Set(),// image URLs already fetched to bytes this session
    observer: null,
    lastSnapshot: null,
    inFlight: false           // gate concurrent async reports
  };

  // -----------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) { console.debug('[benbot-bridge]', ...args); }

  function currentFbThreadId() {
    // messenger.com URLs: /t/<id>, /marketplace_seller/t/<id>, /marketplace_buyer/t/<id>
    const m = location.pathname.match(/\/t\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Best-effort DJB2 hash for a stable external id when FB doesn't give us one.
  function stableHash(...parts) {
    const s = parts.map((p) => (p ?? '')).join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'h:' + h.toString(16);
  }

  function textOf(el) {
    if (!el) return '';
    // aria-label sometimes contains the full message text with sender/time
    // prefix; the contenteditable child usually has the pure body.
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // -----------------------------------------------------------------
  //  Scraping
  // -----------------------------------------------------------------

  /**
   * Build a snapshot of the currently open thread: metadata + visible
   * messages in order. Returns null if we can't identify a thread.
   */
  function snapshotThread() {
    const fbThreadId = currentFbThreadId();
    if (!fbThreadId) return null;

    const region = document.querySelector(SELECTORS.threadRegion);
    if (!region) return null;

    const grid = region.querySelector(SELECTORS.messageGrid);
    const rows = grid ? Array.from(grid.querySelectorAll(SELECTORS.messageRow)) : [];

    // ---- Header / counterparty / listing ----
    const header = region.querySelector(SELECTORS.header);
    let counterpartyName = null;
    if (header) {
      // The header typically has one <h1> or <h2> with the person's name.
      const h = header.querySelector('h1, h2, [role="heading"]');
      if (h) counterpartyName = textOf(h) || null;
    }

    let listingTitle = null;
    let listingUrl = null;
    const card = region.querySelector(SELECTORS.marketplaceCard);
    if (card) {
      listingUrl = card.href;
      // The card contains the listing title as its aria-label or largest text child.
      const t = card.getAttribute('aria-label') || textOf(card.querySelector('span'));
      if (t) listingTitle = t;
    }

    // ---- Messages ----
    const messages = [];
    for (const row of rows) {
      // Skip system rows (day dividers, "seen by" markers) — they have no
      // dir="auto" text content of length > 0.
      const bodies = Array.from(row.querySelectorAll(SELECTORS.textCandidate))
        .map(textOf)
        .filter((t) => t.length > 0);
      if (bodies.length === 0) continue;

      // Longest chunk is very likely the message body. Sender name is usually
      // a shorter sibling on group chats; on 1:1 threads it's absent.
      bodies.sort((a, b) => b.length - a.length);
      const body = bodies[0];

      // Direction: FB places outgoing bubbles inside an element whose
      // aria-label starts with "You sent" / "Sent by you" / equivalent i18n.
      // We fall back to checking for a "delivered" / "seen" marker only
      // appearing on outgoing rows.
      let direction = 'incoming';
      const label = (row.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('you sent') || label.includes('sent by you')) {
        direction = 'outgoing';
      } else {
        const inner = row.querySelector('[aria-label*="You sent" i], [aria-label*="Sent by you" i]');
        if (inner) direction = 'outgoing';
      }

      // Timestamp: FB emits a nested <span> whose textContent looks like
      // "10:42 AM" or "Yesterday 3:14 PM" as a tooltip. The most reliable
      // place is the aria-label on the row itself which usually contains
      // an absolute date. We do a rough parse; if it fails we fall back to now.
      let ts = parseHeuristicDate(row.getAttribute('aria-label')) ?? new Date();

      // Try to grab FB's real message id from any data-attribute.
      let externalId = null;
      const midEl = row.querySelector('[data-mid], [data-msgid], [id^="js_"]');
      if (midEl) {
        externalId = midEl.getAttribute('data-mid')
          || midEl.getAttribute('data-msgid')
          || midEl.id;
      }
      if (!externalId) {
        externalId = stableHash(fbThreadId, ts.toISOString(), direction, body);
      }

      // Image attachments in this row (URLs only; bytes fetched in reportNew).
      const imgSrcs = [];
      for (const img of row.querySelectorAll(SELECTORS.attachmentImg)) {
        // Skip anything with a tiny natural size — those are avatars/emoji.
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w && h && (w < MIN_ATTACHMENT_PX || h < MIN_ATTACHMENT_PX)) continue;
        if (!img.src) continue;
        imgSrcs.push({ src: img.src, width: w || null, height: h || null });
        if (imgSrcs.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
      }

      messages.push({
        externalId,
        direction,
        senderName: direction === 'outgoing' ? 'me' : counterpartyName,
        text: body,
        timestamp: ts.toISOString(),
        imgSrcs
      });
    }

    const snap = {
      fbThreadId,
      counterpartyName,
      counterpartyUrl: null,   // TODO: extract from header profile link
      listingTitle,
      listingUrl,
      messages
    };
    state.lastSnapshot = snap;
    return snap;
  }

  /**
   * Very forgiving parser for aria-label date fragments like
   *   "Alex sent 10:42 AM"
   *   "You sent Yesterday at 3:14 PM"
   *   "Sent Tuesday, Sep 15 at 4:12 PM"
   * Returns null on failure so callers can fall back to Date.now().
   */
  function parseHeuristicDate(label) {
    if (!label) return null;
    // First try to find an explicit "HH:MM AM/PM"; combine with today's date.
    const m = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (/pm/i.test(m[3]) && hour < 12) hour += 12;
    if (/am/i.test(m[3]) && hour === 12) hour = 0;
    const d = new Date();
    if (/yesterday/i.test(label)) d.setDate(d.getDate() - 1);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  /**
   * Diff the snapshot against `state.seen` and push only new messages to
   * the background worker for server ingest. Fetches image attachments as
   * base64 (once per URL) so the server can store them locally.
   */
  async function reportNew(snapshot) {
    if (!snapshot) return;
    if (state.inFlight) return;   // debounce concurrent observer bursts
    const fresh = snapshot.messages.filter((m) => !state.seen.has(m.externalId));
    if (fresh.length === 0 && snapshot.fbThreadId === state.lastFbThreadId) return;

    state.inFlight = true;
    try {
      // Fetch image bytes for any attachments we haven't seen before.
      for (const m of fresh) {
        m.attachments = [];
        for (const img of m.imgSrcs || []) {
          if (state.fetchedImgSrcs.has(img.src)) continue;
          const enc = await fetchImageAsBase64(img.src);
          state.fetchedImgSrcs.add(img.src);
          if (!enc) continue;
          m.attachments.push({
            contentType: enc.contentType,
            dataBase64: enc.base64,
            sourceUrl: img.src,
            width: img.width,
            height: img.height
          });
        }
        delete m.imgSrcs;
      }

      for (const m of fresh) state.seen.add(m.externalId);
      state.lastFbThreadId = snapshot.fbThreadId;

      await chrome.runtime.sendMessage({
        type: 'ingest',
        payload: {
          fbThreadId: snapshot.fbThreadId,
          counterpartyName: snapshot.counterpartyName,
          counterpartyUrl: snapshot.counterpartyUrl,
          listingTitle: snapshot.listingTitle,
          listingUrl: snapshot.listingUrl,
          unread: null,
          messages: fresh
        }
      }).catch((e) => log('sendMessage failed', e));
    } finally {
      state.inFlight = false;
    }
  }

  async function fetchImageAsBase64(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > MAX_ATTACHMENT_BYTES) return null;
      const buf = await blob.arrayBuffer();
      return {
        contentType: blob.type || 'image/jpeg',
        base64: bufferToBase64(buf)
      };
    } catch (e) {
      log('image fetch failed', url, e);
      return null;
    }
  }

  function bufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // -----------------------------------------------------------------
  //  Sending replies
  // -----------------------------------------------------------------

  /**
   * Navigate to a thread by FB thread id, wait for the composer to exist,
   * then type + send. Returns { ok, externalId, error }.
   */
  async function sendReply(fbThreadId, text, opts) {
    const { typeDelayMs = 40, sendJitterMs = 800 } = opts || {};
    try {
      if (currentFbThreadId() !== fbThreadId) {
        // messenger.com is a SPA — pushState is enough, no full navigation.
        history.pushState({}, '', `/t/${fbThreadId}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        // Give the app time to swap threads and render the composer.
        await sleep(1500);
      }

      const composer = await waitFor(SELECTORS.composer, 8000);
      if (!composer) return { ok: false, error: 'composer not found' };

      composer.focus();
      await sleep(120);

      // Human-ish typing: character by character with jitter. execCommand
      // still triggers React's synthetic input handlers on contenteditable.
      for (const ch of text) {
        document.execCommand('insertText', false, ch);
        await sleep(typeDelayMs + Math.random() * typeDelayMs);
      }

      await sleep(Math.random() * sendJitterMs);

      // Enter to send. Some FB revisions bind on keydown, some on keypress.
      // Dispatch both to be safe.
      for (const type of ['keydown', 'keypress', 'keyup']) {
        composer.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
      }
      // Fallback: click the send button if the composer still has content.
      await sleep(300);
      if (composer.textContent && composer.textContent.trim().length > 0) {
        const sendBtn = document.querySelector('div[role="button"][aria-label*="Send" i], button[aria-label*="Send" i]');
        if (sendBtn) sendBtn.click();
        await sleep(300);
      }

      const externalId = stableHash('outbox', fbThreadId, new Date().toISOString(), text);
      return { ok: true, externalId };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  function waitFor(sel, ms) {
    return new Promise((resolve) => {
      const found = document.querySelector(sel);
      if (found) return resolve(found);
      const t0 = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(sel);
        if (el) { clearInterval(iv); resolve(el); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(null); }
      }, 100);
    });
  }

  // -----------------------------------------------------------------
  //  Observation loop
  // -----------------------------------------------------------------

  function attachObserver() {
    if (state.observer) return;
    const target = document.querySelector(SELECTORS.threadRegion) || document.body;
    state.observer = new MutationObserver(debounced(() => {
      const snap = snapshotThread();
      reportNew(snap);
    }, 250));
    state.observer.observe(target, { childList: true, subtree: true, characterData: true });
    log('observer attached');
  }

  function debounced(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Watch for SPA navigation (URL change without full reload).
  setInterval(() => {
    if (location.pathname !== state.lastPathname) {
      state.lastPathname = location.pathname;
      state.seen.clear();
      state.lastFbThreadId = null;
      log('nav to', state.lastPathname);
      // Give the panel a moment to render before scraping.
      setTimeout(() => reportNew(snapshotThread()), 900);
    }
  }, 500);

  attachObserver();

  // Expose a debug hook.
  // eslint-disable-next-line no-undef
  window.__benbot_debug = () => state.lastSnapshot;

  // -----------------------------------------------------------------
  //  Bridge to background worker
  // -----------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'send-reply') {
      sendReply(msg.fbThreadId, msg.text, msg.opts).then(sendResponse);
      return true; // async response
    }
    if (msg?.type === 'snapshot-now') {
      sendResponse(snapshotThread());
      return false;
    }
    return false;
  });
})();
