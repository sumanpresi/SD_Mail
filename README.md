# LifeMail

**Turn email into action.** An email app for Gmail that is built around one move: *read an email → drag it into LifeOS → a task is created that links back to the original email.*

## What it does

- **Gmail & Google Workspace**, several accounts at once, signed in on Google's own page (no passwords in LifeMail)
- **Personal / Work profiles** with a unified inbox per profile, Focus mode and quiet hours
- Inbox, Starred, Snoozed, Drafts, Sent, Archive, All Mail, Spam, Trash
- Conversations, real Gmail **labels** (with colours), **stars**, search with Gmail's search
- **Compose, reply, reply all, forward**, attachments (files and photos), signatures per account, drafts
- **Email → LifeOS** three ways: drag-and-drop, **+ Task** (with suggested title, due date and priority), or Share
- Every converted email gets a ✓ Task badge and (optionally) the Gmail label "LifeOS"
- **Settings and email→task links are stored in your Google Drive** (hidden app folder) — no Supabase, no server
- Desktop-like 3-pane layout on the **Galaxy Z Fold** unfolded, single-pane when folded; light & dark mode
- Works offline for recently viewed lists; safe display of email (scripts blocked, tracking images hidden)
- Installable from Chrome; keyboard shortcuts when a keyboard is attached

## Labels & email rules
- **Labels** (sidebar → Labels → *Edit*, or Settings → Labels): create, rename (sub-labels follow), colour, show/hide in the sidebar, delete (emails are never deleted), and see how many conversations each label has. These are your real Gmail labels.
- **Email rules** (sidebar → *Email rules*): WHEN an email matches (from, from domain, to, cc, subject, email text, has attachment, attachment name — combined with AND / OR) THEN apply/remove a label, mark important, mark read, star or archive. Every rule is checked, so one email can get several labels.
- **Test before you trust it:** “Test with existing emails” shows how many emails a rule would match and why; nothing changes until you choose *apply*. Open any email → ⋯ → *Test rules on this email* shows MATCHED / NOT MATCHED with ✓/✗ for each condition.
- Rules run inside LifeMail whenever it is open (phone or computer) and first catch up on mail that arrived while it was closed. A run history is kept. Rules are saved in your Google Drive file, so every device uses the same rules. Rules never delete email; Archive must be confirmed.

## Android app

Install the Android app for **Work inside LifeMail** (Government Workplace in a built-in browser). See **[ANDROID.md](ANDROID.md)** — download: <https://github.com/sumanpresi/SD_Mail/releases/latest>

## Work = Government Workplace

Tapping **Work** opens the real Government Workplace (`https://workplace.mgovcloud.in/`) — Mail, Calendar, ToDo, Notes, Contacts, Resources.
You sign in on the Government's own page (password + authenticator code); LifeMail never sees, stores or forwards them, and does not copy Government mail anywhere.
The Government site cannot be shown inside another app (its sign-in pages refuse framing and browsers block sign-in cookies in frames), so LifeMail opens it directly — on the installed app it appears on top of LifeMail and Back returns you. Change the address, auto-open and shortcuts in **Settings → Work (Government)**.
If you later add a Gmail account to the Work profile, Work shows that inbox plus a *Government Workplace* entry in the sidebar.

## Start here

1. **Try it:** deploy to Vercel (SETUP.md step 1) and open it — with no Client ID it runs in **demo mode** with sample emails.
2. **Use your Gmail:** follow **[SETUP.md](SETUP.md)** — the "WHAT I NEED TO DO" checklist.
3. **Connect LifeOS:** follow **[LIFEOS_INTEGRATION.md](LIFEOS_INTEGRATION.md)**.

More: [SECURITY.md](SECURITY.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md)

## Try locally on a computer

```
cd lifemail
python3 -m http.server 8765
```
Open <http://localhost:8765> (demo mode).

## Licence notes

DOMPurify (in `js/vendor/`) is © Cure53, Apache-2.0 / MPL-2.0 — see `js/vendor/DOMPurify-LICENSE`.
