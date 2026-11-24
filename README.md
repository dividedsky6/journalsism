# Journalsism

A personal journal app in the spirit of Day One. Plain HTML, CSS and JavaScript with no build step and no framework.

- Color-coded journals, like Day One: a Journals home with each journal as a colored book, its own section with stats, and its color on every entry card, calendar day and in the editor
- File one entry in several journals at once (for example Daily and Career); the first one sets its color, and its card edge shows every journal's color
- Create, rename, recolor and delete journals
- Timeline grouped by month, with an "On this day" strip
- Calendar with Month, Year and All years views. All years stacks every year you've written as a strip of days in journal colors, with each year's journal mix and empty years folded away.
- Month and Year views: days are colored by journal (split when a day has several), tap a month to zoom in or a day to read it, arrow keys step through months or years
- Search, and filters by journal, tag and starred entries
- Markdown writing: `# title`, `**bold**`, `*italic*`, lists, `- [ ]` checklists, `> quotes`
- Import from a Day One JSON export (`.zip` or a single journal `.json`)
- Backup to a JSON file and restore from it

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Daily reminder ("What happened today?")

On iPhone, Journalism can send a nightly notification and put a badge on its icon on days you haven't written.

1. Open the site in Safari → **Share → Add to Home Screen**, then open Journalism from that icon. The Home Screen app keeps its own copy of your journal, so import your Day One file or a backup there.
2. **Settings → Daily reminder → Turn on daily reminders**, and allow notifications.
3. Tap **Copy setup code** and paste it as the repo secret `PUSH_SUBSCRIPTIONS` (**Settings → Secrets and variables → Actions → New repository secret**). For more devices, put one code per line. Each device makes its own key pair, which lives only on that device and in the secret.

The schedule is `.github/workflows/reminder.yml` (9:00 pm Pacific; edit both cron lines and `REMINDER_TIME` to change it). **Actions → Daily reminder → Run workflow** sends one immediately to test. The notification comes every evening, since the scheduler can't see your private entries; the badge clears once you've written that day.

## App passcode

After you unlock your journal on a device, the app asks you to choose a 4-digit passcode. From then on it asks for it each time you open the app and after 5 minutes away. It's a lock screen for that device only; it isn't stored in the repo. **Settings → App passcode** changes it or turns it off. **Forgot passcode?** on the lock screen lets you in with the long journal passcode and removes the 4-digit one.

## Your journal on this site (passcode-locked)

`journal.locked.json` holds your entries encrypted with a passcode (PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM). The file is unreadable without the passcode, even though the repo is public. On a device with no entries yet, the app asks for the passcode once, unlocks the journal and saves it on that device. You can also tap **Settings → Unlock the journal saved on this site**. **Start empty** skips it.

The passcode is never stored in the repo. If you lose it, the locked file can't be opened, but your entries are still on any device that already unlocked them, and in your backups.

## Where entries are stored

In the browser's IndexedDB (`storage.js`), on the device you use. Nothing is sent to a server. That means:

- Entries don't sync between devices or browsers.
- Clearing site data deletes them, so back up monthly. When it's been 30 days (or you've never backed up), the app asks when it opens. **Save backup** opens the share sheet on iPhone/iPad, where you pick **Save to Files → iCloud Drive**; on a computer it downloads. **Remind me tomorrow** snoozes for a day.
- A backup is one `.json` file with every entry, journal and color. Restore it from **Import**.

`storage.js` exposes three methods (`all`, `put`, `delete`). To add syncing later, replace that file with one that talks to a backend (Supabase, Firebase, your own API) and keep the same methods.

## Importing from Day One

1. In Day One: Settings → Import/Export → Export → **JSON**.
2. In Journalism: **Import & backup** → choose the `.zip`.

Each journal file becomes its own color-coded journal. Day One's export doesn't include journal colors, so `config.js` sets them by journal name; any other journal gets the next free color. You can change a color anytime with **Edit journal**, including a custom color. Entries keep their dates, time zones, tags, stars, places and weather. Photos, videos and audio are skipped. Re-running an import skips entries that are already there.

If you copied entries between journals in Day One, the importer spots them and offers to merge each set into one entry filed in all its journals (**Import → Copies across journals**). The earliest version is kept, and merged copies won't come back on a re-import.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup: header, tabs, entry sheet, dialog |
| `styles.css` | All styling, light and dark |
| `app.js` | Views, editor, markdown renderer, Day One importer, backup |
| `config.js` | Your settings: default colors for journals by name (Day One's export has no colors) |
| `sw.js` | Service worker: works offline, shows the daily reminder, sets the badge |
| `manifest.webmanifest`, `icons/` | Home Screen app name and icons |
| `scripts/send-reminder.mjs`, `.github/workflows/reminder.yml` | The daily reminder sender and its schedule |
| `storage.js` | IndexedDB storage: entries and journal settings (name, color) |

## Publishing with GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the site on every push to `main`. Turn it on under **Settings → Pages → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public (your entries are never in the repo, only the app).

Anyone who opens the site gets their own empty journal, stored in their own browser.

## Privacy

Don't commit Day One exports or backup files. `.gitignore` already excludes `*.zip` and `journalism-backup-*.json`.

## Built to last

Tested with 12,000 entries spanning 20 years: the app opens in about 1.5 s, and most screens redraw in under 0.15 s. Derived lists (sorting, journal stats, word counts) are cached and rebuilt only when entries change. Backups are plain JSON you can read in any text editor, so your writing never depends on this app.
