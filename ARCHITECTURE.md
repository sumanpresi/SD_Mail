# How LifeMail is built

## Big picture

```
 ┌────────────── Samsung Z Fold (Chrome, installed app) ──────────────┐
 │                                                                     │
 │   LifeMail (this app)                       LifeOS (your app)        │
 │   ─────────────────                         ─────────────────        │
 │   Sidebar │ List │ Reader   ──drag / link / share──►  receiver.js   │
 │       │                                                  │           │
 └───────┼──────────────────────────────────────────────────┼───────────┘
         │ HTTPS (your Google sign-in)                      │ (unchanged —
         ▼                                                  ▼  Supabase etc.)
   Gmail API  (email)      Google Drive appData (LifeMail settings file)
```

- **No server, no build step.** Plain HTML/CSS/JavaScript modules, hosted as static files on Vercel.
- **Why a web app (PWA) rather than a Kotlin APK?** It matches LifeOS (same install method, same hosting, you can edit it on GitHub), it runs on the Fold, tablets, phones and computers, and it needs no Android Studio, signing keys or Play Store. On the Fold it installs like a normal app and supports split screen and drag-and-drop.

## Files

```
index.html               App page (+ icon set)
oauth.html               Where Google returns after sign-in
manifest.webmanifest     Makes it installable
sw.js                    Offline support (caches app files only — never email)
css/app.css              All styling (light/dark, Fold/phone layouts)
js/config.js             ← the only file you edit (Google Client ID)
js/app.js                Main screen: sidebar, list, drag wiring, keyboard, notifications
js/reader.js             Reading pane, safe email display, attachments
js/compose.js            New / reply / reply-all / forward / drafts
js/task.js               Email → LifeOS (payload, drag, + Task panel, share)
js/settings.js           Settings screens
js/actions.js            Archive, delete, star, labels, unread (with undo)
js/gmail.js              GmailProvider — the only file that knows Gmail's API
js/demo.js               DemoProvider — sample mailbox with the same methods
js/store.js              Settings file in Google Drive + offline cache
js/auth.js               Google sign-in (no secrets)
js/lib.js                Pure helpers (MIME, payload, links, suggestions) — unit tested
js/vendor/purify.min.js  DOMPurify email sanitiser
lifeos-kit/              Receiver for LifeOS + drop test page
tests/                   Unit tests, browser tests, mock-Gmail tests
```

## Providers (Gmail now, Outlook / IMAP later)

The screens never call Gmail directly. They call a **provider** with these methods:

```
listThreads({folderId, search, labelId, pageToken}) → {threads, nextPageToken}
getThread(threadId) → thread with messages, html/text, attachments
getAttachment(messageId, attachmentId) → data (downloaded only when you open it)
modifyThread / modifyMessage(add, remove)   trashThread / untrashThread
listLabels / ensureLabel(name)              inboxUnread()
send(mime, threadId) / saveDraft / deleteDraft / findDraftId
currentHistoryId / newInboxMessages(historyId)   (cheap new-mail check)
```

`GmailProvider` and `DemoProvider` both implement it. A `MicrosoftProvider` (Microsoft Graph, Outlook/365) can be added as one new file implementing the same methods, plus a Microsoft sign-in in `auth.js`; folders map through `FOLDERS` in `lib.js`. Generic IMAP cannot run inside a browser, so IMAP would need a small server — that is the one provider that changes the "no server" design.

## Gmail efficiency

- Lists ask for 25 conversations at a time ("Load more" for the next page).
- Conversation summaries are fetched with `format=metadata` (headers only) and cached by Gmail's `historyId`, so unchanged conversations are not downloaded again.
- Full email bodies are fetched only when you open an email; attachments only when you tap them.
- New-mail checks use Gmail's History API (one tiny request per account per interval).
- Search uses Gmail's own search (`from:`, `subject:`, `has:attachment`, `label:` …) — nothing is downloaded to search locally.

## Data model

### In Google Drive: `lifemail-data.json` (hidden app folder)

```json
{
  "schema": 1,
  "updatedAt": 1791277000000,
  "storageAccount": "suman@gmail.com",
  "accounts": [
    { "email": "suman@gmail.com", "name": "Suman", "picture": "", "displayName": "Suman · Personal",
      "profile": "personal", "color": "#3a6ea5", "signature": "— Suman", "notify": true }
  ],
  "profiles": {
    "personal": { "name": "Personal", "notify": "all", "quiet": { "enabled": false, "start": "22:00", "end": "07:00" } },
    "work":     { "name": "Work",     "notify": "important", "quiet": { "enabled": true, "start": "19:00", "end": "09:00" } }
  },
  "focus": "",
  "labelColors": { "Follow Up": "#d9822b", "NGDR": "#2f7d6d" },
  "pinnedLabels": ["Follow Up", "Awaiting", "NGDR"],
  "settings": {
    "theme": "system", "density": "comfortable", "remoteImages": "ask", "notifications": false, "pollSeconds": 90,
    "smartSuggest": true,
    "lifeos": { "enabled": true, "urlTemplate": "https://…/?lifemail={payload}", "projects": ["NGDR", "GSI"],
                "defaultProject": "", "defaultPriority": "medium", "defaultDue": "none", "labelOnTask": true }
  },
  "taskLinks": [
    { "id": "…", "account": "suman@gmail.com", "threadId": "18c…", "title": "Send report", "project": "NGDR", "due": "2026-10-09", "createdAt": "…" }
  ]
}
```

Sync rule: the copy with the newer `updatedAt` wins; accounts added on a device that Drive does not know yet are kept. Changes are saved to Drive 1.5 s after you stop editing.

### On the device

| Key | Holds |
|---|---|
| `localStorage lm_data_v1` | Copy of the Drive file (instant start, offline) |
| `localStorage lm_tokens_v1` | 1-hour Google access tokens per account |
| `IndexedDB lifemail-cache` | Last list per view (≤ 60 summaries) for offline viewing |

Labels, stars, read state, archive/trash are **Gmail's own** — LifeMail does not keep a separate copy, so Gmail on other devices always agrees.

## Layouts

| Screen width | Layout |
|---|---|
| ≥ 1180 px (tablet landscape, Fold landscape, computer) | Full sidebar · list · reading pane |
| 760–1179 px (Fold unfolded) | Icon rail · list · reading pane; ☰ opens the full sidebar |
| < 760 px (Fold folded, phones) | One pane at a time; reading pane slides over; sidebar is a drawer; Compose button |

## On-device task suggestions (no AI)

`suggestTask()` in `lib.js` reads the subject and the "please/kindly …" sentence to propose a title, and phrases like "by Friday", "tomorrow", "by 15/10/2026", "urgent" for due date and priority. It is shown in the + Task panel for you to edit — it never creates anything by itself. An AI provider can be added later behind the same panel; it would need a small server to keep its API key secret.
