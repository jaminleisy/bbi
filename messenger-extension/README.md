# BenBot Messenger Bridge (Chrome MV3 extension)

Copies Facebook Messenger conversations (including Marketplace threads) into
the BenBot Inventory API at `/api/messenger/*`. The extension only scrapes
an open `messenger.com` tab and posts history to the server. It does **not**
type or send replies. Open a thread in BenBot to get copyable suggestions.

> **Terms of Service warning.** Scraping messenger.com still violates Meta's
> ToS. Use a dedicated Facebook account and keep usage comparable to a real
> seller. This is a personal-use tool.

## 1. Server-side setup

1. Pull the latest server code. The `DbSeeder` will create the three new
   tables (`MessengerThreads`, `MessengerMessages`, `MessengerOutbox`) on
   next startup.
2. Add a bot token in `Server/appsettings.json`:

   ```jsonc
   "Messenger": { "BotToken": "GENERATE-A-LONG-RANDOM-STRING" }
   ```

   Pick something ≥32 chars. Never commit the real value — use user secrets
   or an environment variable in production
   (`Messenger__BotToken=<value>`).
3. Start the server as usual (`dotnet run` from `Server/`). Confirm:

   ```
   curl -H "X-Bot-Token: <your token>" http://localhost:5000/api/messenger/ping
   ```

   should return `{ "ok": true, "time": "..." }`.

## 2. Load the extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, select the `messenger-extension/` folder.
3. (Optional) Pin the extension so the popup is one click away.
4. Right-click the icon → **Options**, or open the popup and click
   **Settings**. Fill in:
   - **API base URL** — e.g. `http://localhost:5000`
   - **Bot token** — the exact value from `appsettings.json`
5. Click **Test connection**. You should get `OK — server time: …`.

## 3. Use it

1. Open `https://www.messenger.com/` in the same Chrome profile and log in.
2. Open a conversation. Within a second or two the popup's **Last ingest**
   should tick — the thread is now in BenBot **Messages**.
3. In BenBot, open the thread. Matching rules show a **Copy** suggestion.
   Paste it into Messenger yourself. The extension never sends.

## 4. API surface

All extension endpoints require `X-Bot-Token`; the user-facing endpoints
require a normal JWT (same as your other controllers).

| Method | Path                                        | Auth       | Purpose                              |
|--------|---------------------------------------------|------------|--------------------------------------|
| GET    | `/api/messenger/ping`                       | Bot token  | Health check                         |
| POST   | `/api/messenger/ingest`                     | Bot token  | Upsert thread + append messages      |
| GET    | `/api/messenger/threads`                    | JWT        | List threads, newest first           |
| GET    | `/api/messenger/threads/{id}/messages`      | JWT        | Transcript for one thread            |
| GET    | `/api/messenger/threads/{id}/suggestions`   | JWT        | Copyable reply suggestions           |
| POST   | `/api/messenger/threads/{id}/read`          | JWT        | Mark thread read                     |
| POST   | `/api/messenger/threads/{id}/link`          | JWT        | Link thread to a `Computer` build    |

## 5. When Facebook breaks the scraper

Meta reshuffles the messenger.com DOM every few weeks. All the fragile bits
are in one place — the `SELECTORS` block at the top of `content.js`:

```js
const SELECTORS = {
  threadRegion:    'div[role="main"]',
  messageGrid:     'div[role="grid"]',
  messageRow:      'div[role="row"]',
  textCandidate:   'div[dir="auto"]',
  composer:        'div[role="textbox"][contenteditable="true"]',
  header:          'div[role="banner"], header',
  marketplaceCard: 'a[href*="/marketplace/item/"]'
};
```

Debug workflow when something stops working:

1. Open a Marketplace thread on `messenger.com` and refresh the tab after
   reloading the extension.
2. Click the extension icon and look at the debug JSON (`media.imgTotal`,
   `media.kept`). Or in DevTools → Console run `__benbot_debug()` after
   refreshing the tab (the hook is injected in the page world). Look at
   what's `null` or empty.
3. In DevTools → Elements, inspect the corresponding DOM chunk and pick
   a stable-looking selector (prefer `role`, `aria-label`, and `dir="auto"`
   over CSS classes — FB hashes classes and rotates them).
4. Update `SELECTORS`, reload the extension from `chrome://extensions`,
   revisit the tab.

## 6. Reliability upgrades (future)

- **WebSocket hook**: `injected.js` is a stub. Loading it via a `<script>`
  element from `content.js` will run in page context and can monkey-patch
  `WebSocket.prototype.send`/`onmessage` to capture the real message events
  Meta uses under the hood. Much more robust than DOM scraping but harder
  to update when they change the payload shape.
- **Multiple tabs**: the current worker sends replies through the first
  open messenger.com tab it finds. If you want to isolate accounts, split
  by Chrome profile or add a `preferredTabId` to storage.
- **Attachments**: not currently ingested. Add image capture in the content
  script and a `PartImage`-style storage table if you need to record
  screenshots from buyers.

## 7. Files

```
messenger-extension/
├── manifest.json      MV3 manifest
├── background.js      Service worker — network + polling
├── content.js         Scraper + reply-sender injected into messenger.com
├── injected.js        Page-context stub (future WS hook)
├── options.html/js    Settings page (API URL, token, timing)
├── popup.html/js      Toolbar popup (status + Sync now)
└── README.md          This file
```

Icons aren't included — Chrome will fall back to a puzzle icon. Drop
`icon-16.png`, `icon-48.png`, `icon-128.png` in this folder and add an
`icons` block to `manifest.json` when you want to brand it.
