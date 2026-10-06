# LifeMail for Android

The Android app has two parts:

| | What you see | How it works |
|---|---|---|
| **Personal** | Your LifeMail (Gmail) — same as the website | The LifeMail web app inside the app. Google sign-in uses Android's own Google account system, because Google blocks its sign-in page inside apps. |
| **Work** | **Government Workplace inside LifeMail** — Mail, Calendar, ToDo, Notes, Contacts, Resources | A real built-in browser showing `workplace.mgovcloud.in`. You sign in on the Government page (password + authenticator code) inside the app. |

Tap **Work** in LifeMail → Workplace opens inside the app. The bar at the top has **✉ (back to Personal) · ← · → · ⟳ · 🔒 site name · ⋮**.
The ⋮ menu has Reload, Workplace home, Desktop site, Full screen, Open in browser, Clear Work session, Back to Personal.
The phone's **Back** gesture steps back through Workplace pages first, then returns to Personal.

---

## WHAT YOU NEED TO DO (one time, ~15 minutes)

### Step 1 — Give GitHub the app's signing key (needed for Google sign-in and for updates)

Android only lets an app update itself if every version is signed with the same key, and Google sign-in checks that key too.
The key was created for you and is **not** stored on GitHub. You received two files: `keystore-base64.txt` and `keystore-password.txt`.

1. Open <https://github.com/sumanpresi/SD_Mail/settings/secrets/actions>
2. **New repository secret** → Name: `LIFEMAIL_KEYSTORE_B64` → Secret: paste **all** the text from `keystore-base64.txt` → **Add secret**
3. **New repository secret** → Name: `LIFEMAIL_KEYSTORE_PASSWORD` → Secret: paste the text from `keystore-password.txt` → **Add secret**
4. Open <https://github.com/sumanpresi/SD_Mail/actions/workflows/android.yml> → **Run workflow** → **Run workflow**. In about 5 minutes a new release appears whose notes say **Signing: permanent key**.

Keep both files somewhere safe and private (for example your password manager). Anyone with them could sign apps as LifeMail.

### Step 2 — Allow the Android app to use Google sign-in (Personal)

1. <https://console.cloud.google.com/> → project **my-mail** → **APIs & Services → Credentials**
2. **Create credentials → OAuth client ID** → Application type **Android**
3. Name: `LifeMail Android` · Package name: `com.suman.lifemail`
4. SHA-1 certificate fingerprint:

```
7E:8B:DA:A2:C8:8C:E2:E0:8C:6B:7E:3A:5F:9E:3C:C6:82:50:48:1C
```

5. **Create**. Nothing needs to be copied into LifeMail — Google recognises the app by package name + SHA-1.
   (Your existing "LifeMail Web" client stays as it is for the website.)

### Step 3 — Install on the Fold

1. On the phone open <https://github.com/sumanpresi/SD_Mail/releases/latest>
2. Tap **LifeMail.apk** → open the download → if asked, allow Chrome to *install unknown apps* → **Install**.
3. Open **LifeMail**, sign in with Google (Personal), then tap **Work**.

**Updating:** install the newer `LifeMail.apk` from the same page over the old one.
If Android says "App not installed" / "conflicts with an existing package", the old copy was signed with a different key (for example a build made before Step 1): uninstall LifeMail once, then install the new one.

---

## Security — what LifeMail does and does not do

- **Government sign-in stays with the Government.** Workplace, its sign-in page and MFA load in a plain built-in browser. LifeMail injects nothing into those pages, reads nothing from them and stores no password, OTP/TOTP or token.
- **Work is isolated.** Work runs in its own Android process with its own browser storage folder. Government cookies/session never mix with Personal, and **Clear Work session** wipes only the Work browser.
- **No security bypasses.** Certificate errors are never ignored, everything is https (http links are upgraded), `file://` access is off, and the Government site's own security rules are respected. Nothing is proxied through any server.
- **Personal sign-in** uses Android's Google account system; LifeMail receives a 1-hour Gmail token, kept only on the phone.
- **The bridge** between the LifeMail page and the app is locked to `https://sd-mail-tau.vercel.app`; no other website (including Workplace) can use it.
- **No cloud backup** of app data (Government session cookies are excluded from Android backup and device transfer).
- Downloads from Workplace go to the phone's **Downloads** folder via Android's download manager using your own Workplace session. Uploads go straight from the Android file picker to the Government site.

## Known limitations

- If the Government site ever decides to refuse built-in browsers, LifeMail will not work around it; use ⋮ → **Open in browser**.
- Files that the Government site creates *inside the page* (rather than as a normal download link) cannot be saved by Android's download manager; use **Open in browser** for those.
- New-mail notifications are not shown by the Android app yet (the website/PWA version can show them while open).
- The app is installed from GitHub, not the Play Store.

## How it is built

- Source: `android/` (Kotlin). Key files: `MainActivity.kt` (Personal + Google sign-in bridge), `WorkActivity.kt` (Work browser), `LifeMailApp.kt` (Work isolation), `Web.kt` (safe links, file picker, saving files).
- Every change under `android/` triggers **.github/workflows/android.yml**, which builds the APK on GitHub and publishes it as a release.
- The web page detects the app through `js/bridge.js`; in a normal browser nothing changes.
