# Connecting LifeMail to LifeOS

LifeMail never writes into LifeOS's database. It **hands LifeOS a small, well-defined package** (the "payload") describing the email, and LifeOS decides how to create the task. LifeOS keeps working exactly as it does today (Supabase and all) — only a receiver is added.

## The three ways an email reaches LifeOS

| Route | How you use it | When it works |
|---|---|---|
| **1. Drag and drop** | Long-press an email row (or the green **+ Task** button) and drag it onto LifeOS | LifeMail and LifeOS open **side by side** (split screen) or LifeOS as a **pop-up window** on the Fold; also two browser windows on a computer |
| **2. + Task → Send to LifeOS** | Open an email → **+ Task** → edit title/project/due/priority → **Send to LifeOS** | Always. Opens LifeOS with the task pre-filled |
| **3. Share** | **+ Task → Share…**, or long-press a row → *Share to LifeOS* | Always, once LifeOS is installed as an app with a share target |

All three carry the same payload. If one is not available on a device, the others still work — you never get stuck.

### Honest note about Android drag-and-drop

Dragging between two apps on Android depends on the phone and the receiving app. On the Galaxy Z Fold with Chrome-installed apps in split screen, dragging text and links between apps is supported, and LifeMail puts the email on the drag as plain text + a link, which is what cross-app drag carries most reliably. Test it with the **drop test page** (below) before relying on it. If a particular combination refuses the drop, routes 2 and 3 do exactly the same job in two taps.

---

## Add the receiver to LifeOS (about 10 minutes)

1. Copy `lifeos-kit/lifemail-receiver.js` into the LifeOS project (next to its `index.html`).
2. In LifeOS's `index.html`, before `</body>`:

```html
<script src="/lifemail-receiver.js"></script>
<script>
  LifeMailReceiver.init({
    onTask(task) {
      // Replace this line with LifeOS's own "new task" function. Example:
      openNewTaskDialog({
        title: task.title,
        due: task.due,            // 'YYYY-MM-DD' or ''
        priority: task.priority,  // 'high' | 'medium' | 'low' | ''
        project: task.project,
        notes: [task.notes, task.emailUrl && ('Email: ' + task.emailUrl)].filter(Boolean).join('\n'),
        sourceLink: task.emailUrl,        // opens the original in Gmail
        lifemailLink: task.lifemailUrl,   // opens the email in LifeMail
        destination: task.destination     // 'today' / 'waiting' … when dropped on a special zone
      });
    }
  });
  // Optional: drop zones with meaning (use your own element ids)
  // LifeMailReceiver.dropZone(document.getElementById('today'),   { destination: 'today' });
  // LifeMailReceiver.dropZone(document.getElementById('waiting'), { destination: 'waiting' });
</script>
```

> Best practice: show LifeOS's normal "Create task" dialog pre-filled (so you confirm), rather than saving silently.

3. To receive **Share**, add this to LifeOS's `manifest.json`, then re-install LifeOS on the phone once:

```json
"share_target": {
  "action": "/",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

4. In LifeMail → **Settings → LifeOS → LifeOS address**, enter LifeOS's address with `{payload}`:

```
https://YOUR-LIFEOS.vercel.app/?lifemail={payload}
```

5. Press **Send a test task**. LifeOS should open with "LifeMail connection test".

If LifeOS uses hash routes (e.g. `/#/tasks`), use `https://YOUR-LIFEOS.vercel.app/?lifemail={payload}#/tasks`.

### Optional: let LifeMail emails open from LifeOS tasks

`task.lifemailUrl` looks like `https://YOUR-LIFEMAIL/#open=account/threadId` and opens that exact email in LifeMail. `task.emailUrl` opens it in Gmail (by its permanent Message-ID, so it works even after you archive or relabel it).

---

## Test before touching LifeOS: the drop test page

`https://YOUR-LIFEMAIL/lifeos-kit/test-receiver.html` pretends to be LifeOS and shows **exactly** what LifeOS would receive.

On the Fold:
1. Open LifeMail. Open the test page in Chrome (or install it — it is also a share target named **Drop Test**).
2. Put them in split screen (swipe the taskbar app into the screen, or use the Edge panel).
3. Long-press an email in LifeMail, drag it across, and drop it on **Today**, **Tomorrow** or **Waiting for**.
4. The page lists every field received. Also try **Share → Drop Test**, and **Settings → LifeOS → Send a test task**.

---

## The payload (integration contract, version 1)

```json
{
  "v": 1,
  "source": "lifemail",
  "provider": "gmail",
  "account": "suman@gmail.com",
  "messageId": "18c1f0a2b3c4d5e6",
  "threadId": "18c1f0a2b3c4d5e0",
  "rfcMessageId": "<abc123@bisag-n.example>",
  "subject": "NGDR Portal API issue",
  "senderName": "Rakesh Patel",
  "senderEmail": "rakesh@bisag-n.example",
  "emailDate": "2026-10-06T04:30:00.000Z",
  "emailUrl": "https://mail.google.com/mail/?authuser=suman%40gmail.com#search/rfc822msgid%3Aabc123%40bisag-n.example",
  "lifemailUrl": "https://YOUR-LIFEMAIL/#open=suman%40gmail.com/18c1f0a2b3c4d5e0",
  "preview": "Kindly share the list of report IDs that failed…",
  "attachments": ["api-error-log.txt"],
  "task": {
    "title": "Share the list of report IDs that failed to upload in Lot-15",
    "project": "NGDR",
    "due": "2026-10-09",
    "priority": "medium",
    "destination": "",
    "notes": "",
    "keepEmailLink": true
  },
  "createdFromEmail": true,
  "createdAt": "2026-10-06T09:02:11.000Z"
}
```

### How it travels

| Route | Where the payload is |
|---|---|
| Drag | `text/plain` (readable summary whose last line is `lifemail-payload:<base64url JSON>`), `text/uri-list` (Gmail link), `text/html`, and `application/x-lifemail+json` (same-browser drags) |
| Link | `?lifemail=<base64url JSON>` in the LifeOS address — the receiver removes it from the address bar after reading |
| Share | `text` contains the same readable summary + `lifemail-payload:` line; `url` is the Gmail link |
| Copy | Same text on the clipboard; pasting it anywhere in LifeOS creates the task |

A plain Gmail link dropped into LifeOS (from anywhere) also creates a basic "Follow up on email" task.

### Security rules the receiver already applies

- **Never contains secrets.** No passwords, no OAuth tokens, no Drive data — only what you can see on screen.
- Only known fields are kept; everything is treated as plain text and length-limited.
- Links are accepted only if they start with `https://`, so a crafted payload cannot inject `javascript:` links.
- Priority must be `high`/`medium`/`low`; due must be `YYYY-MM-DD`; otherwise blank.
- LifeOS should still display these fields with `textContent` (not `innerHTML`), as with any user input.
