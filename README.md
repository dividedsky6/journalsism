# Journalism

A personal journal app in the spirit of Day One. Plain HTML, CSS and JavaScript with no build step and no framework.

- Timeline grouped by month, with an "On this day" strip
- Calendar view, search, and filters by journal, tag and starred entries
- Markdown writing: `# title`, `**bold**`, `*italic*`, lists, `- [ ]` checklists, `> quotes`
- Import from a Day One JSON export (`.zip` or a single journal `.json`)
- Backup to a JSON file and restore from it

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Where entries are stored

In the browser's IndexedDB (`storage.js`), on the device you use. Nothing is sent to a server. That means:

- Entries don't sync between devices or browsers.
- Clearing site data deletes them, so use **Import & backup → Download backup** regularly.

`storage.js` exposes three methods (`all`, `put`, `delete`). To add syncing later, replace that file with one that talks to a backend (Supabase, Firebase, your own API) and keep the same methods.

## Importing from Day One

1. In Day One: Settings → Import/Export → Export → **JSON**.
2. In Journalism: **Import & backup** → choose the `.zip`.

Each journal file becomes its own journal. Entries keep their dates, time zones, tags, stars, places and weather. Photos, videos and audio are skipped. Re-running an import skips entries that are already there.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup: header, tabs, entry sheet, dialog |
| `styles.css` | All styling, light and dark |
| `app.js` | Views, editor, markdown renderer, Day One importer, backup |
| `storage.js` | IndexedDB storage |

## Publishing with GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the site on every push to `main`. Turn it on under **Settings → Pages → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public (your entries are never in the repo, only the app).

Anyone who opens the site gets their own empty journal, stored in their own browser.

## Privacy

Don't commit Day One exports or backup files. `.gitignore` already excludes `*.zip` and `journalism-backup-*.json`.
