// Content script for messenger.com — scrapes the currently open thread and
// executes reply commands dispatched by the background service worker.
//
// FB rewrites CSS class names constantly, so this file targets stable
// affordances: ARIA roles, aria-label text, dir="auto" bubbles, and URL
// patterns. When something breaks, adjust the SELECTORS block at the top.
//
// Debug tip: from the messenger.com console run
//     __benbot_debug()
// to see the last snapshot the observer produced.

(() => {
  'use strict';

  // -----------------------------------------------------------------
  // Selectors — the small blast radius when FB reshuffles DOM
  // -----------------------------------------------------------------
  const SELECTORS = {
    threadRegion: 'div[role="main"]',
    conversation: [
      '[aria-label*="Messages in conversation" i]',
      '[aria-label*="Conversation with" i]',
      '[role="log"]',
      '[role="grid"]'
    ].join(', '),
    messageRow: '[role="row"], [role="listitem"]',
    // Text bubbles are marked with dir="auto" on a div OR span.
    textCandidate: 'div[dir="auto"], span[dir="auto"]',
    composer: 'div[role="textbox"][contenteditable="true"]',
    header: 'div[role="banner"], header, [role="main"] [role="heading"]',
    marketplaceCard: 'a[href*="/marketplace/item/"]'
  };

  const PHOTO_CDN = /fbcdn\.net|cdninstagram\.com|lookaside\.fbsbx\.com|scontent/i;
  const PHOTO_SKIP = /static\.xx\.fbcdn|rsrc\.php|\/emoji|safe_image\.php/i;

  const CHROME_TEXT = /^(aa|enter|send|seen|delivered|active now|type a message|search|gif|open more actions|attach a file|choose a gif|send a like|you sent|sent|photo|video|opened|unsent a message)$/i;
  const TIME_TEXT = /^(yesterday\s+)?\d{1,2}:\d{2}\s*(am|pm)?$/i;
  const LONG_DATE = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}(,\s+\d{1,2}:\d{2}\s*(am|pm)?)?$/i;
  const WEEKDAY_TIME = /^(today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}:\d{2}\s*(am|pm)?$/i;
  // Facebook's screen-reader label on each bubble.
  const A11Y_MSG = /^(?:Enter,\s*)?Message sent\s+(.+?)\s+by\s+([^:]+):\s*([\s\S]*)$/i;
  // "You sent a photo" / "Colton sent 2 photos" / "You sent an image"
  const A11Y_MEDIA = /^(?:Enter,\s*)?(You|.+?)\s+sent\s+(?:you\s+)?(?:an?\s+)?(?:(\d+)\s+)?(photos?|images?|pictures?|videos?|gifs?)\b/i;
  const JUNK_NAME = /^(messenger|facebook|instagram|marketplace)(\s*[|\-–—]\s*(messenger|facebook|instagram|marketplace))*$/i;
  const MEDIA_WORD = /^(photos?|images?|pictures?|videos?|gifs?|sent a photo|sent an image)$/i;

  const state = {
    lastPathname: '',
    lastFbThreadId: null,
    lastMetaKey: '',
    lastMediaKey: '',
    seen: new Set(),
    observer: null,
    lastSnapshot: null,
    inFlight: false,
    dead: false
  };

  const MEDIA_NOTE = /^\s*\[(?:\d+\s+)?(?:Photos?|Videos?|GIFs?)\]\s*$/i;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

  function log(...args) { console.debug('[benbot-bridge]', ...args); }

  // After chrome://extensions → Reload, this tab still runs the old content
  // script. chrome.runtime is dead; further sendMessage calls throw
  // "Extension context invalidated". Stop quietly until the user refreshes.
  function extensionAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); }
    catch { return false; }
  }

  function isContextDead(err) {
    return /extension context invalidated/i.test(String(err && err.message || err));
  }

  function retire(reason) {
    if (state.dead) return;
    state.dead = true;
    if (state.observer) {
      try { state.observer.disconnect(); } catch { /* already gone */ }
      state.observer = null;
    }
    log('retired:', reason || 'extension reloaded — refresh this tab');
  }

  function currentFbThreadId() {
    // /t/<id>, /marketplace_seller/t/<id>, /marketplace_buyer/t/<id>
    const m = location.pathname.match(/\/t\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function stableHash(...parts) {
    const s = parts.map((p) => (p ?? '')).join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'h:' + h.toString(16);
  }

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isJunkName(n) {
    return !n || JUNK_NAME.test(n.trim());
  }

  function isDateDivider(t) {
    if (!t || t.length > 80) return false;
    return TIME_TEXT.test(t) || LONG_DATE.test(t) || WEEKDAY_TIME.test(t);
  }

  function isChromeText(t) {
    if (!t) return true;
    if (t.length > 200) return false;
    return CHROME_TEXT.test(t) || isDateDivider(t);
  }

  function normalizeMediaKind(word) {
    const w = String(word || '').toLowerCase();
    if (w.startsWith('gif')) return 'GIF';
    if (w.startsWith('video')) return 'Video';
    return 'Photo';
  }

  function mediaNote(kind, count) {
    const n = count && count > 1 ? count : 0;
    if (n) return kind === 'Photo' ? `[${n} Photos]` : `[${n} ${kind}s]`;
    return `[${kind}]`;
  }

  function parseA11yMessage(label) {
    if (!label) return null;
    const raw = String(label).trim();
    const media = raw.match(A11Y_MEDIA);
    if (media && !/message sent/i.test(raw)) {
      const who = media[1].trim();
      const outgoing = /^you$/i.test(who) || /^me$/i.test(who);
      const count = media[2] ? parseInt(media[2], 10) : 1;
      const kind = normalizeMediaKind(media[3]);
      return {
        when: null,
        sender: outgoing ? 'me' : who,
        body: mediaNote(kind, count),
        outgoing,
        media: true
      };
    }

    const m = raw.match(A11Y_MSG);
    if (!m) return null;
    const when = m[1].trim();
    const sender = m[2].trim();
    let body = (m[3] || '').replace(/\s+/g, ' ').trim();
    const outgoing = /^you$/i.test(sender) || /^me$/i.test(sender);
    if (isDateDivider(body)) body = '';
    if (body && MEDIA_WORD.test(body)) {
      return { when, sender: outgoing ? 'me' : sender, body: '[Photo]', outgoing, media: true };
    }
    if (!body) return { when, sender: outgoing ? 'me' : sender, body: '', outgoing, media: false, empty: true };
    return { when, sender: outgoing ? 'me' : sender, body, outgoing, media: false };
  }

  function imgUrl(img) {
    if (!img) return '';
    return img.currentSrc
      || img.getAttribute('src')
      || img.getAttribute('data-src')
      || (img.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0]
      || '';
  }

  function isPhotoUrl(url) {
    if (!url || url.startsWith('data:image/svg')) return false;
    if (PHOTO_SKIP.test(url)) return false;
    // e2ee threads decrypt the preview into a data: JPEG, not fbcdn/blob.
    if (/^data:image\/(jpeg|jpg|png|webp|gif)/i.test(url)) return true;
    return PHOTO_CDN.test(url) || url.startsWith('blob:');
  }

  function mediaKey(url, el, alt) {
    if (url && /^https?:/i.test(url)) return url.split('?')[0];
    if (url && url.startsWith('data:')) return `data:${url.length}:${url.slice(22, 80)}`;
    if (url && url.startsWith('blob:')) return url.split('?')[0];
    return `anon:${(alt || '').slice(0, 32)}:${el.getAttribute('width') || 0}x${el.getAttribute('height') || 0}`;
  }

  const MAX_ATTACH_BYTES = 2 * 1024 * 1024;

  function packMedia(url, w, h) {
    const attachments = [];
    let mediaUrl = null;
    if (!url) return { mediaUrl, attachments };
    if (/^https?:\/\//i.test(url)) {
      mediaUrl = url.length > 1000 ? url.slice(0, 1000) : url;
    } else if (/^data:image\//i.test(url)) {
      const comma = url.indexOf(',');
      if (comma > 0) {
        const header = url.slice(0, comma);
        const data = url.slice(comma + 1);
        const typeMatch = header.match(/^data:(image\/[a-zA-Z0-9.+-]+)/i);
        if (typeMatch && data.length * 0.75 <= MAX_ATTACH_BYTES) {
          attachments.push({
            contentType: /jpe?g/i.test(typeMatch[1]) ? 'image/jpeg' : typeMatch[1],
            dataBase64: data,
            sourceUrl: null,
            width: w || null,
            height: h || null
          });
        }
      }
    }
    return { mediaUrl, attachments };
  }

  const MAX_PAYLOAD_BASE64 = 250000;

  function prepareIngestMessages(list, withBytes) {
    const out = [];
    let budget = MAX_PAYLOAD_BASE64;
    for (const m of list) {
      const copy = {
        externalId: m.externalId,
        direction: m.direction,
        senderName: m.senderName,
        text: m.text,
        timestamp: m.timestamp,
        mediaUrl: m.mediaUrl || null,
        attachments: []
      };
      if (withBytes) {
        let atts = Array.isArray(m.attachments) ? m.attachments : [];
        if (!atts.length && m._dataUrl) atts = packMedia(m._dataUrl).attachments;
        const b64 = atts[0] && atts[0].dataBase64;
        if (b64 && b64.length <= budget) {
          copy.attachments = [atts[0]];
          budget -= b64.length;
        }
      }
      out.push(copy);
    }
    return out;
  }

  // Avatar thumbs use Facebook's "-1" rendition (t39.30808-1). Message
  // photos are -6 / attachments / blob: URLs in encrypted chats.
  function isProfilePicUrl(url) {
    if (!url || url.startsWith('blob:')) return false;
    return /\/t[\d.]+-1\//.test(url) || /\/s(?:32|40|50|60|80)x\d+\//.test(url);
  }

  function elementSize(el) {
    const r = el.getBoundingClientRect();
    return {
      w: Math.max(r.width, el.naturalWidth || 0, Number(el.getAttribute('width')) || 0),
      h: Math.max(r.height, el.naturalHeight || 0, Number(el.getAttribute('height')) || 0),
      r
    };
  }

  function toLocalIso(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function isComposerChrome(el, composer) {
    if (!el) return true;
    // Do NOT skip [role=button] — message photos are themselves buttons
    // ("Open photo"). Only the compose tray / chrome around it.
    if (el.closest && el.closest('[role="toolbar"], [role="tablist"], [role="navigation"], [role="banner"], [role="menu"], [role="dialog"]'))
      return true;
    if (composer) {
      if (composer.contains(el) || (el.contains && el.contains(composer))) return true;
      const cr = composer.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top >= cr.top - 16) return true;
    }
    return false;
  }

  function looksLikeAvatar(el) {
    const { w, h } = elementSize(el);
    if (w > 0 && h > 0 && w <= 56 && h <= 56) return true;
    try {
      const br = getComputedStyle(el).borderRadius || '';
      if (w <= 80 && h <= 80 && (/50%|999px|100%/.test(br) || parseFloat(br) >= Math.min(w, h) / 2 - 1))
        return true;
    } catch { /* ignore */ }
    return false;
  }

  function inSidebarRail(el, root) {
    const pane = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width < 4 && r.height < 4) return false;
    // Thread column (composer ancestor) is already to the right of the chat
    // list. Incoming photos sit on the LEFT of that column — do not treat
    // them as sidebar.
    if (pane.left > 180 || pane.width < 1000) return false;
    return r.right < 360 && r.left < 200;
  }

  function inferOutgoing(el, root) {
    let n = el;
    for (let i = 0; i < 10 && n && n !== root; i++, n = n.parentElement) {
      const t = (n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('alt') || '') || '').toLowerCase();
      if (t.includes('you sent') || t.includes('sent by you')) return true;
    }
    const rr = root.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    if (rr.width < 80 || br.width < 2) return false;
    return (br.left + br.width / 2) > (rr.left + rr.width * 0.55);
  }

  /**
   * Find photos/videos in the open conversation. Does not require role=row
   * or a finished image decode — FB often lazy-sets src later.
   */
  function collectMediaMessages(root, composer, fbThreadId) {
    const items = [];
    const seen = new Set();
    let imgTotal = 0;
    let imgCdn = 0;
    let skippedProfile = 0;
    let skippedSidebar = 0;
    let blobs = 0;
    const sampleSrcs = [];

    const skip = (el) => {
      if (!el || !root.contains(el)) return true;
      if (composer && (composer.contains(el) || el.contains?.(composer))) return true;
      if (el.closest && el.closest(SELECTORS.marketplaceCard)) return true;
      if (inSidebarRail(el, root)) {
        skippedSidebar++;
        return true;
      }
      return false;
    };

    const timeFromAncestors = (el) => {
      let n = el;
      for (let i = 0; i < 8 && n && n !== root; i++, n = n.parentElement) {
        const label = n.getAttribute && n.getAttribute('aria-label');
        if (!label) continue;
        const parsed = parseA11yMessage(label);
        if (parsed && parsed.when) return parseWhen(parsed.when, label);
        const guessed = parseHeuristicDate(label);
        if (guessed) return guessed;
      }
      return null;
    };

    const add = (key, el, kind, outgoing, when, url) => {
      const canon = String(key || '').split('?')[0];
      if (!canon || seen.has(canon)) return;
      seen.add(canon);
      const pack = packMedia(url);
      items.push({
        externalId: stableHash(fbThreadId, 'media', canon, outgoing ? 'out' : 'in'),
        direction: outgoing ? 'outgoing' : 'incoming',
        senderName: outgoing ? 'me' : null,
        text: kind.startsWith('[') ? kind : `[${kind}]`,
        timestamp: toLocalIso(when || timeFromAncestors(el) || new Date(0)),
        mediaUrl: pack.mediaUrl,
        attachments: [],
        _dataUrl: url && url.startsWith('data:') ? url : null,
        _blobUrl: url && url.startsWith('blob:') ? url : null,
        _top: el.getBoundingClientRect().top,
        media: true
      });
    };

    // Facebook's own "You sent a photo" / "Jim sent a GIF" labels are the
    // only high-confidence signal. Toolbar "Choose a GIF" is chrome.
    for (const el of root.querySelectorAll('[aria-label]')) {
      if (skip(el) || isComposerChrome(el, composer)) continue;
      const label = el.getAttribute('aria-label') || '';
      const parsed = parseA11yMessage(label);
      if (!parsed || !parsed.media) continue;
      const nearby = el.querySelector?.('img, video');
      const nearbyUrl = nearby ? (imgUrl(nearby) || nearby.currentSrc || nearby.src || '') : '';
      add('aria:' + label, el, parsed.body, parsed.outgoing, parseWhen(parsed.when, label), nearbyUrl);
    }

    for (const img of root.querySelectorAll('img')) {
      imgTotal++;
      const url = imgUrl(img);
      if (url.startsWith('blob:')) blobs++;
      if (isPhotoUrl(url)) {
        imgCdn++;
        if (sampleSrcs.length < 6) sampleSrcs.push(url.slice(0, 96));
      }
      if (isProfilePicUrl(url)) {
        skippedProfile++;
        continue;
      }
      if (skip(img) || isComposerChrome(img, composer)) continue;
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const openMedia = /^open (photo|image|picture|gif|video)s?$/.test(alt);
      if (!openMedia && looksLikeAvatar(img)) continue;
      const { w, h } = elementSize(img);
      // "Open photo" is Facebook's label on the decrypted preview (often a
      // data: JPEG inside a role=button). Trust that even if layout is tall
      // and skinny. Other imgs still need a real photo-sized box.
      if (!openMedia && (w < 140 || h < 140)) continue;
      if (!openMedia && !isPhotoUrl(url)) continue;
      if (!openMedia && /emoji|sticker|avatar/i.test(alt)) continue;
      const kind = /gif/.test(alt + url) ? 'GIF' : /video/.test(alt) ? 'Video' : 'Photo';
      add(mediaKey(url, img, alt), img, kind, inferOutgoing(img, root), null, url);
    }

    for (const v of root.querySelectorAll('video')) {
      if (skip(v) || isComposerChrome(v, composer)) continue;
      const url = v.currentSrc || v.getAttribute('src') || '';
      const { w, h } = elementSize(v);
      if (w < 80 && h < 80 && !url) continue;
      add(mediaKey(url || 'video', v, 'video'), v, 'Video', inferOutgoing(v, root), null, url);
    }

    return {
      items,
      debug: {
        imgTotal,
        imgCdn,
        blobs,
        skippedProfile,
        skippedSidebar,
        kept: items.length,
        sampleSrcs
      }
    };
  }

  function parseWhen(when, fallbackLabel) {
    const heuristic = parseHeuristicDate([when, fallbackLabel].filter(Boolean).join(' '));
    if (heuristic) return heuristic;
    if (when) {
      const normalized = when.replace(/(\d)(AM|PM)/i, '$1 $2');
      const d = new Date(normalized);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
    }
    return new Date();
  }

  function finalizeMessages(messages) {
    messages.sort((a, b) => (a._top ?? 0) - (b._top ?? 0));
    let lastTextIso = null;
    for (const m of messages) {
      if (m.media) {
        if (lastTextIso) m.timestamp = lastTextIso;
      } else {
        lastTextIso = m.timestamp;
      }
    }
    let lastMs = 0;
    for (const m of messages) {
      let ms = Date.parse(m.timestamp);
      if (!Number.isFinite(ms)) ms = lastMs || Date.now();
      if (ms <= lastMs) ms = lastMs + 1000;
      lastMs = ms;
      m.timestamp = toLocalIso(new Date(ms));
      delete m._top;
      delete m.media;
    }
    return messages;
  }

  function hasSentLabel(el) {
    return !!(el && el.querySelector && el.querySelector('[aria-label*="Message sent" i]'));
  }

  // Search box is also role=textbox. The real composer is low and wide.
  function findComposer() {
    const boxes = Array.from(document.querySelectorAll(SELECTORS.composer));
    const visible = boxes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 10 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!visible.length) return boxes[0] || null;
    visible.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.top - ar.top) || (br.width - ar.width);
    });
    return visible[0];
  }

  /**
   * The open thread must contain actual "Message sent …" bubbles.
   * Walking up from the composer used to stop on the footer (same width
   * as the column, but no messages) when the column was >68% of the
   * viewport.
   */
  function findConversationRoot() {
    const panes = Array.from(document.querySelectorAll(SELECTORS.conversation));
    for (const node of panes) {
      const r = node.getBoundingClientRect();
      if (r.width > 240 && r.height > 160 && r.left > 140 && hasSentLabel(node)) return node;
    }
    for (const node of panes) {
      const r = node.getBoundingClientRect();
      if (r.width > 240 && r.height > 160 && r.left > 140) return node;
    }

    const composer = findComposer();
    if (composer) {
      let el = composer.parentElement;
      let candidate = null;
      let bestWidth = Infinity;
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        const includesSidebar = r.left < 80 && r.width > window.innerWidth * 0.75;
        const tooWide = r.width > window.innerWidth * 0.94;
        const tallEnough = r.height > Math.min(220, window.innerHeight * 0.28);
        if (hasSentLabel(el) && tallEnough && r.width > 280 && r.width <= bestWidth && !tooWide && !includesSidebar) {
          candidate = el;
          bestWidth = r.width;
        }
        el = el.parentElement;
      }
      if (candidate) return candidate;

      el = composer.parentElement;
      while (el && el !== document.body) {
        if (hasSentLabel(el)) return el;
        el = el.parentElement;
      }
    }

    const sent = Array.from(document.querySelectorAll('[aria-label*="Message sent" i]')).filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 4 && r.left > 140 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (sent.length) {
      let p = sent[0].parentElement;
      while (p && p !== document.body) {
        const r = p.getBoundingClientRect();
        if (sent.every((n) => p.contains(n)) && r.width < window.innerWidth * 0.94 && r.left > 80)
          return p;
        p = p.parentElement;
      }
      return sent[0].closest('[role="main"], [role="grid"], [role="log"]') || sent[0].parentElement;
    }

    return document.querySelector(SELECTORS.threadRegion) || document.body;
  }

  function isVisibleInPane(el, pane) {
    if (!pane || !pane.contains(el)) return false;
    const r = el.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < p.top || r.top > p.bottom) return false;
    // Chat-list rail is the left ~360px.
    if (r.right < 300 && r.left < 80) return false;
    return true;
  }

  function extractCounterparty(root, labeledSenders) {
    const counts = {};
    for (const name of labeledSenders) {
      if (!name || /^me$/i.test(name) || isJunkName(name)) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
    const inferred = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (inferred) return inferred[0];

    const aria = root.getAttribute('aria-label') || '';
    const fromAria = aria.match(/(?:conversation with|messages in conversation with)\s+(.+)/i);
    if (fromAria && !isJunkName(fromAria[1])) return fromAria[1].trim();

    const heading = root.querySelector('h1, h2, [role="heading"]');
    const headingText = textOf(heading);
    if (headingText && !isJunkName(headingText) && !isDateDivider(headingText)) return headingText;

    return null;
  }

  /**
   * Build a snapshot of the currently open thread: metadata + visible
   * messages in order. Returns null if we can't identify a thread.
   */
  function snapshotThread() {
    const fbThreadId = currentFbThreadId();
    if (!fbThreadId) return null;

    const root = findConversationRoot();
    if (!root) return null;

    const composer = findComposer();

    let listingTitle = null;
    let listingUrl = null;
    const card = root.querySelector(SELECTORS.marketplaceCard) || document.querySelector(SELECTORS.marketplaceCard);
    if (card && (root.contains(card) || isVisibleInPane(card, root))) {
      listingUrl = card.href;
      const t = card.getAttribute('aria-label') || textOf(card.querySelector('span, div[dir="auto"]'));
      if (t && !isJunkName(t)) listingTitle = t;
    }

    // Prefer Facebook's per-bubble aria-label — it has sender + body.
    // Walking role=row and taking the longest dir=auto was grabbing the
    // whole a11y sentence plus leftover threads still in the SPA DOM.
    const labeled = [];
    const seenText = new Set();
    for (const el of root.querySelectorAll('[aria-label]')) {
      if (composer && (composer === el || composer.contains(el) || el.contains(composer))) continue;
      if (!isVisibleInPane(el, root)) continue;
      const parsed = parseA11yMessage(el.getAttribute('aria-label'));
      if (!parsed || parsed.empty || !parsed.body) continue;
      // Media-only labels are handled in collectMediaMessages so we don't
      // depend on role=row / decoded <img> size.
      if (parsed.media) continue;

      const key = (parsed.outgoing ? 'out' : 'in') + '|' + parsed.body + '|' + (parsed.when || '');
      if (seenText.has(key)) continue;
      seenText.add(key);

      const ts = parseWhen(parsed.when, el.getAttribute('aria-label'));
      labeled.push({
        externalId: stableHash(fbThreadId, parsed.body, parsed.outgoing ? 'out' : 'in', parsed.when || ''),
        direction: parsed.outgoing ? 'outgoing' : 'incoming',
        senderName: parsed.outgoing ? 'me' : parsed.sender,
        text: parsed.body,
        timestamp: toLocalIso(ts),
        _top: el.getBoundingClientRect().top
      });
    }

    let media = { items: [], debug: { imgTotal: 0, imgCdn: 0, blobs: 0, skippedProfile: 0, skippedSidebar: 0, kept: 0, sampleSrcs: [] } };
    try {
      media = collectMediaMessages(root, composer, fbThreadId);
    } catch (err) {
      log('collectMediaMessages failed', err);
    }
    const messages = finalizeMessages(labeled.concat(media.items));
    const counterpartyName = extractCounterparty(root, labeled
      .filter((m) => m.direction === 'incoming')
      .map((m) => m.senderName));

    const snap = {
      fbThreadId,
      counterpartyName,
      counterpartyUrl: null,
      listingTitle,
      listingUrl,
      messages,
      _debug: {
        href: location.href,
        rowCount: labeled.length,
        messageCount: messages.length,
        media: media.debug,
        rootAria: (root.getAttribute('aria-label') || '').slice(0, 120),
        rootRole: root.getAttribute('role'),
        rootWidth: Math.round(root.getBoundingClientRect().width),
        rootHeight: Math.round(root.getBoundingClientRect().height),
        composerFound: !!composer,
        sentInRoot: root.querySelectorAll('[aria-label*="Message sent" i]').length,
        sentInDoc: document.querySelectorAll('[aria-label*="Message sent" i]').length
      }
    };
    state.lastSnapshot = snap;
    publishSnapshot(snap);
    return snap;
  }

  /**
   * Very forgiving parser for aria-label date fragments like
   *   "Alex sent 10:42 AM"
   *   "You sent Yesterday at 3:14 PM"
   */
  async function blobToAttach(url) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_ATTACH_BYTES) return null;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return {
      contentType: type,
      dataBase64: btoa(bin),
      sourceUrl: null,
      width: null,
      height: null
    };
  }

  function parseHeuristicDate(label) {
    if (!label) return null;
    const text = String(label);
    const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (/pm/i.test(m[3]) && hour < 12) hour += 12;
    if (/am/i.test(m[3]) && hour === 12) hour = 0;
    const d = new Date();
    const longDate = text.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),\s+(\d{4})/i
    );
    if (longDate) {
      d.setFullYear(parseInt(longDate[3], 10), MONTHS[longDate[1].toLowerCase()], parseInt(longDate[2], 10));
    } else if (/yesterday/i.test(text)) {
      d.setDate(d.getDate() - 1);
    } else {
      const wd = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (wd) {
        const diff = (d.getDay() - WEEKDAYS.indexOf(wd[1]) + 7) % 7;
        if (diff > 0) d.setDate(d.getDate() - diff);
      }
    }
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  async function reportNew(snapshot, opts) {
    if (state.dead || !extensionAlive()) {
      retire('runtime gone');
      return;
    }
    if (!snapshot) return;
    if (state.inFlight) return;
    if ((!snapshot.messages || snapshot.messages.length === 0) && !snapshot.counterpartyName) {
      try {
        chrome.runtime.sendMessage({ type: 'scrape-empty', scrape: snapshot._debug });
      } catch { /* ignore */ }
      return;
    }
    const all = !!(opts && opts.all);
    const fresh = snapshot.messages.filter((m) => !state.seen.has(m.externalId));
    const metaKey = [snapshot.fbThreadId, snapshot.counterpartyName || '', snapshot.listingTitle || ''].join('|');
    const metaChanged = metaKey !== state.lastMetaKey;
    const mediaIds = (snapshot.messages || [])
      .filter((m) => MEDIA_NOTE.test(m.text || ''))
      .map((m) => m.externalId);
    const mediaKey = mediaIds.join(',');
    if (fresh.length === 0 && snapshot.fbThreadId === state.lastFbThreadId && !metaChanged && mediaKey === state.lastMediaKey && !all)
      return;

    state.inFlight = true;
    try {
      const source = all ? snapshot.messages : fresh;
      for (const m of source) {
        if (m._blobUrl && (!m.attachments || m.attachments.length === 0)) {
          try {
            const att = await blobToAttach(m._blobUrl);
            if (att) m.attachments = [att];
          } catch { /* blob already revoked */ }
        }
      }

      const payloadBase = {
        fbThreadId: snapshot.fbThreadId,
        counterpartyName: snapshot.counterpartyName,
        counterpartyUrl: snapshot.counterpartyUrl,
        listingTitle: snapshot.listingTitle,
        listingUrl: snapshot.listingUrl,
        unread: null,
        visibleMediaExternalIds: mediaIds
      };

      const send = (messages) => chrome.runtime.sendMessage({
        type: 'ingest',
        payload: { ...payloadBase, messages },
        scrape: snapshot._debug
      });

      try {
        await send(prepareIngestMessages(source, true));
      } catch (e) {
        if (isContextDead(e)) {
          retire(e.message);
          return;
        }
        log('ingest with images failed, retrying text-only', e);
        try {
          await send(prepareIngestMessages(source, false));
        } catch (e2) {
          if (isContextDead(e2)) retire(e2.message);
          else log('sendMessage failed', e2);
          return;
        }
      }

      for (const m of fresh) state.seen.add(m.externalId);
      state.lastFbThreadId = snapshot.fbThreadId;
      state.lastMetaKey = metaKey;
      state.lastMediaKey = mediaKey;
    } finally {
      state.inFlight = false;
    }
  }

  function attachObserver() {
    const target = findConversationRoot() || document.body;
    if (state.observer) {
      try { state.observer.disconnect(); } catch { /* already gone */ }
      state.observer = null;
    }
    state.observer = new MutationObserver(debounced(() => {
      const snap = snapshotThread();
      reportNew(snap);
    }, 250));
    state.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'aria-label', 'style', 'alt']
    });
    for (const img of target.querySelectorAll('img')) {
      if (img.__benbotLoad) continue;
      img.__benbotLoad = true;
      img.addEventListener('load', () => reportNew(snapshotThread()), { once: true });
    }
    log('observer attached');
  }

  function debounced(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function scrapeNow() {
    const snap = snapshotThread();
    reportNew(snap, { all: true });
    // Images often appear after the text (lazy src). Re-scrape a few times
    // even when text already ingested.
    [1200, 3000, 6000].forEach((ms) => {
      setTimeout(() => reportNew(snapshotThread(), { all: true }), ms);
    });
  }

  function publishSnapshot(snap) {
    let el = document.getElementById('__benbot_debug_json');
    if (!el) {
      el = document.createElement('script');
      el.id = '__benbot_debug_json';
      el.type = 'application/json';
      document.documentElement.appendChild(el);
    }
    try {
      const slim = {
        ...snap,
        messages: (snap.messages || []).map((m) => ({
          externalId: m.externalId,
          direction: m.direction,
          text: m.text,
          mediaUrl: m.mediaUrl || null
        }))
      };
      el.textContent = JSON.stringify(slim);
    } catch { /* circular / huge */ }
  }

  setInterval(() => {
    if (state.dead || !extensionAlive()) {
      retire('runtime gone');
      return;
    }
    if (location.pathname !== state.lastPathname) {
      state.lastPathname = location.pathname;
      state.seen.clear();
      state.lastFbThreadId = null;
      state.lastMetaKey = '';
      state.lastMediaKey = '';
      log('nav to', state.lastPathname);
      attachObserver();
      setTimeout(scrapeNow, 400);
    }
  }, 500);

  attachObserver();
  setTimeout(scrapeNow, 800);

  window.__benbot_debug = () => state.lastSnapshot;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'snapshot-now') {
      scrapeNow();
      sendResponse(state.lastSnapshot);
      return false;
    }
    return false;
  });
})();
