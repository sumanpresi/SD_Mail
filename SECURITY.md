# LifeMail security — in plain language

LifeMail is an email app, so it is built on one rule: **your email and your Google sign-in only ever travel between your device and Google.** There is no LifeMail server, no database, no analytics and no third-party service in between.

## Sign-in

- You sign in on **Google's own page**. LifeMail never sees, asks for, or stores your password.
- Google gives LifeMail an **access token that expires after 1 hour**. LifeMail renews it by asking Google again (silently when possible).
- There is **no refresh token and no client secret** anywhere. If someone copied the app files, they would get nothing that opens your mailbox.
- Each sign-in uses a random one-time "state" value that is checked on return, so a forged sign-in response is rejected.
- The token is removed from the address bar immediately after sign-in.

**Permissions requested (least needed):**

| Permission | Why | What it cannot do |
|---|---|---|
| `gmail.modify` | Read mail, labels, star, archive, move to Trash, send, drafts | Cannot permanently delete email; cannot change Gmail settings or filters |
| `drive.appdata` | Save LifeMail's one settings file in a **hidden app folder** | **Cannot see any of your other Drive files** |
| `openid email profile` | Know which account just signed in | — |

You can withdraw access at any time at <https://myaccount.google.com/permissions>.

## Where data lives

| Data | Stored where | Contains secrets? |
|---|---|---|
| Your email | Gmail. **Plus an offline copy on this device** (Settings → Offline & search; on by default, last 30 days): text, headers, pictures inside emails, and attachments you have opened — in the device's private app storage (IndexedDB), never in Google Drive or anywhere else. Spam/Trash are not copied; Government Workplace mail is never copied | No |
| Settings, profiles, label colours, signatures, email→task links | `lifemail-data.json` in your Drive's hidden app folder + a copy on the device | No |
| Access tokens (1-hour) | This device only (browser storage of the LifeMail site) | Yes — never leaves the device, never put in Drive, links, LifeOS, logs or backups |

"Sign out of all accounts on this device" (Settings → Privacy) revokes the tokens with Google and deletes the offline copy. Removing an account deletes that account's copy; Settings → Offline & search → "Remove email from this device" deletes it at any time. Changes made offline wait in an outbox on the device until they are sent to Gmail.

## Showing email safely

Emails can contain dangerous code. LifeMail treats every email as hostile:

1. **Cleaned** with DOMPurify (a widely used, independently audited sanitiser): scripts, event handlers, forms, inputs, embedded frames/objects, `<meta>`/`<base>` tricks and `javascript:` links are removed.
2. **Shown inside a locked box** (`<iframe sandbox>` *without* `allow-scripts`), so even if something slipped through, it cannot run.
3. The box has its own **Content Security Policy** that blocks loading anything from the internet unless you allow images.
4. **Remote images are hidden by default** (they are often tracking pixels that reveal when/where you opened an email). Choose per email, or set Always / Wi-Fi only / Never in Settings → Privacy.
5. Links open in a new window with `noopener noreferrer`, so the site you visit cannot see or control LifeMail.

These protections are covered by automated tests that load a deliberately malicious email (`tests/e2e.py`, "hostile" checks).

## The app itself

- Strict **Content Security Policy** on LifeMail: scripts only from LifeMail's own files (no CDNs), network calls only to Google's API addresses.
- Hosting headers: HTTPS only (HSTS), no framing by other sites, no referrer, no camera/microphone/location.
- Deep links (`#open=account/thread`) are checked strictly; an account that is not yours is refused.
- Everything sent to LifeOS is validated and length-limited on both sides (see `LIFEOS_INTEGRATION.md`).
- No secrets are in the code, so nothing secret can leak via GitHub. The Google **Client ID** in `js/config.js` is designed to be public.

## Known limits (honest)

- Tokens are held in the browser's storage for the LifeMail site. That is standard for browser email apps; the strict CSP above is what prevents other code from reaching them, and they expire within an hour.
- Notifications only arrive while LifeMail is open or recently used (there is no server to push them). Keep Gmail's own notifications on if you need instant alerts when LifeMail is closed.
- In Google "Testing" mode, Google shows an "unverified app" notice at sign-in. That is normal for a private app.
