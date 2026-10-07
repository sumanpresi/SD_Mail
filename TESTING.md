# Testing LifeMail

## Automated tests (already run — all passing)

| Suite | What it checks | Result |
|---|---|---|
| `tests/lib.test.mjs` (12 tests) | Email address parsing, MIME building (Unicode subjects, attachments, reply headers), Gmail message parsing incl. inline images, LifeOS payload creation / encoding / validation against hostile input, deep-link parsing, folder mapping, task suggestions, quiet hours | ✅ 12/12 |
| `tests/e2e.py` (46 checks, demo mode, real browser) | Profiles, conversations, inline images, attachments, **drag payload → drop receiver** (text-only, like cross-app Android drag), drop zones, **+ Task → Send to LifeOS**, task badge, star/label/archive/undo, reply-all addressing, signature, address validation, search, settings, dark mode, **hostile email** (scripts, `javascript:` links, forms, tracking pixels), phone layout, Google sign-in request | ✅ 46/46 |
| `tests/gmail_mock.py` (16 checks, real-Gmail code path against a fake Google API) | Gmail list/paging, labels, mark-read, attachment download, reply sent in-thread with correct headers, archive, **Drive settings file created in the hidden app folder without tokens**, task links synced to Drive, expired-session handling | ✅ 16/16 |

Run them yourself (needs Python with Playwright and Node 18+):

```
cd lifemail
python3 -m http.server 8765 &        # serves the app locally
node --test tests/*.test.mjs
python3 tests/e2e.py
python3 tests/gmail_mock.py
python3 tests/rules.py        # labels + email rules (demo mode)
python3 tests/rules_gmail.py  # email rules against a fake Gmail API
```

## What could not be tested here (please test on the Fold)

These depend on your real Google account and your physical phone:

1. **Real Google sign-in** (needs your Client ID) — Settings → Accounts.
2. **Cross-app drag on the Fold** — use the drop test page (`/lifeos-kit/test-receiver.html`) in split screen. See `LIFEOS_INTEGRATION.md`.
3. **Android Share** — install the drop test page, then + Task → Share… → *Drop Test*.
4. **Notifications** — Settings → Notifications → on; send yourself an email while LifeMail is in the background.

## Manual checklist on the Fold

- [ ] Folded: list → tap email → reads full screen → back arrow returns
- [ ] Unfolded: icon rail + list + reading pane side by side; ☰ opens full sidebar
- [ ] Personal / Work switch shows the right accounts; unread counts update
- [ ] Compose from Work account; From selector shows both profiles
- [ ] Attach a photo from the gallery; send to yourself; it arrives in Gmail
- [ ] Open an email with images: images hidden until "Show images"
- [ ] Drag an email into the drop test page in split screen
- [ ] + Task → Send to LifeOS opens LifeOS with the task filled in
- [ ] Airplane mode: list still shows, "Offline" is displayed; reconnect refreshes
- [ ] Settings on a second device (tablet/computer) appear after signing in there
