# Setting up LifeMail — what YOU need to do

Total time: about 30–40 minutes, once. No coding. You only edit **one line** in one file.

LifeMail is an installable web app (the same kind as LifeOS). It is hosted for free on Vercel from a GitHub repository, then installed on your Fold from Chrome. Nothing needs a server, a database or Supabase — LifeMail talks to Gmail directly and keeps its own small settings file in your Google Drive.

---

## ✅ WHAT I NEED TO DO — checklist

1. ☐ Put the LifeMail folder on GitHub and deploy it on Vercel → you get an address like `https://lifemail-suman.vercel.app`
2. ☐ Create a Google Cloud project
3. ☐ Turn on the **Gmail API** and the **Google Drive API**
4. ☐ Set up the Google sign-in screen ("OAuth consent screen") and add yourself as a test user
5. ☐ Create a **Client ID** (type: Web application) and paste it into `js/config.js`
6. ☐ Push the change → Vercel redeploys automatically
7. ☐ Open LifeMail on the Fold in Chrome → ⋮ menu → **Install app**
8. ☐ Sign in with Google, add your other accounts, assign Personal / Work
9. ☐ Connect LifeOS (see `LIFEOS_INTEGRATION.md`) and test drag-and-drop

You can do step 1 and try **demo mode** straight away — with no Client ID set, LifeMail opens with sample emails.

---

## Step 1 — GitHub + Vercel (same as your other projects)

1. Create a new GitHub repository, e.g. `lifemail` (private is fine).
2. Upload **everything inside** the `lifemail` folder (so `index.html` is at the top level of the repository).
3. In Vercel: **Add New → Project → Import** the repository.
   - Framework preset: **Other**. Build command: *leave empty*. Output directory: *leave empty*.
   - Click **Deploy**.
4. Note your address, for example `https://lifemail-suman.vercel.app`. You need it in step 5.

Open it now — you will see LifeMail in **DEMO** mode with sample emails. Everything works there except real sending.

## Step 2 — Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with your main Gmail.
2. Top bar → project picker → **New project** → name it `LifeMail` → **Create**. Make sure it is selected.

## Step 3 — Turn on the two APIs

1. Menu ☰ → **APIs & Services → Library**.
2. Search **Gmail API** → **Enable**.
3. Search **Google Drive API** → **Enable**.

## Step 4 — The sign-in screen (OAuth consent screen)

1. Menu ☰ → **APIs & Services → OAuth consent screen** (newer consoles call this **Google Auth Platform → Branding / Audience / Data access**).
2. User type: **External** → Create.
3. App name: `LifeMail`. Support email and developer email: your Gmail. Save.
4. **Scopes / Data access → Add or remove scopes**, add exactly these:
   - `.../auth/gmail.modify`
   - `.../auth/drive.appdata`
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
5. **Audience / Test users → Add users**: add **every Gmail address** you will use in LifeMail (personal and work Gmail accounts).
6. Leave the publishing status as **Testing**. That is correct for personal use — Google allows up to 100 test users without a review.

> When you sign in, Google will show "Google hasn't verified this app". That is expected for your own private app. Click **Continue**.

## Step 5 — Create the Client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `LifeMail web`.
3. **Authorised JavaScript origins** → Add URI: `https://lifemail-suman.vercel.app` (your address from step 1, no slash at the end).
4. **Authorised redirect URIs** → Add URI: `https://lifemail-suman.vercel.app/oauth.html`
5. **Create**. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
   - You will also see a "Client secret". **LifeMail does not use it. Do not put it anywhere.**
6. Open `js/config.js` in GitHub (pencil icon to edit) and paste the Client ID between the quotes:

```js
googleClientId: '1234567890-abc123.apps.googleusercontent.com',
```

7. Commit. Vercel redeploys in about a minute.

A Client ID is **not** a secret — it is meant to be visible in web apps. There are no passwords, keys or secrets anywhere in LifeMail, so there is no `.env` file to set up.

## Step 6 — Install on the Samsung Galaxy Z Fold

1. On the Fold, open **Chrome** and go to your LifeMail address.
2. ⋮ menu → **Install app** (or **Add to Home screen → Install**).
3. Open LifeMail from the home screen. It runs full-screen like a normal app, and adapts when you fold/unfold.

Samsung Internet also works; Chrome is recommended for the best drag-and-drop support.

## Step 7 — Sign in and organise accounts

1. Tap **Sign in with Google** and choose your account. Tick **all** permission boxes.
2. **Settings → Accounts → Add Google / Gmail account** for each extra account.
3. For each account choose **Profile: Personal or Work**, a colour, and a signature.
4. **Settings → Data & Sync** shows which account's Drive holds LifeMail's settings file.

### About your official GSI email

LifeMail v1 supports **Gmail and Google Workspace** accounts. An official mailbox on a government mail system (non-Google) cannot be read by a browser app directly — that needs IMAP, which needs a small server. Options today:
- set your official mailbox to auto-forward to a dedicated Gmail account, and add that Gmail to the Work profile; or
- keep the official mailbox in its own app and use LifeMail for Gmail.

The code is already structured so an Outlook (Microsoft 365) or IMAP provider can be added later (see `ARCHITECTURE.md`).

## Step 8 — Connect LifeOS

See `LIFEOS_INTEGRATION.md`. In short: copy one file into LifeOS, add two lines, then in LifeMail **Settings → LifeOS** enter your LifeOS address.

---

## Day-to-day notes

- **Sign-in renews itself.** Google's browser sign-ins last one hour. LifeMail renews them on your next tap — you may see a window flash briefly. If Google wants you to confirm, a **Reconnect** bar appears; tap it.
- **Updating LifeMail:** change files on GitHub → Vercel redeploys → the app updates the next time it opens.
- **Removing access:** <https://myaccount.google.com/permissions> → LifeMail → Remove access.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Error 400: redirect_uri_mismatch" | The redirect URI in step 5 must be exactly `https://YOUR-ADDRESS/oauth.html` |
| "Error 403: access_denied" | Add that Gmail address as a **Test user** (step 4.5) |
| "Please tick all permission boxes" | Sign in again and tick Gmail and Drive on Google's screen |
| Still in DEMO mode after adding the Client ID | Wait for Vercel to finish, then close and reopen the app. Settings → Data & Sync → Leave demo |
| "Drive sync problem" at the bottom left | Settings → Accounts → Reconnect the account shown in Data & Sync |
