# Snap · Expense Tracker

Photograph a receipt and the expense records itself. A mobile-first, offline-capable
expense tracker that works for whatever you need to track — household spending, a
business, a rental, a trip, a build, or a lifestyle block.

No accounts, no server, no subscription. Everything lives on the device.

## The idea

Adding an expense should take one tap and one glance:

1. Tap the camera button.
2. Point it at the receipt.
3. Check the pre-filled amount, date, shop and category, and save.

Nothing is typed unless the reader gets something wrong, and anything it guessed at
is flagged so you know where to look.

## Use cases

The tracker is organised into **workspaces**. Each one has its own categories,
currency, colour and records, and you switch between them from the app bar.

| Preset | For |
| --- | --- |
| Personal | Everyday household spending |
| Small Business | Trade, contracting or a side hustle |
| Lifestyle Block | Small farm, orchard or land block |
| Rental Property | Investment property income and costs |
| Trip / Travel | A holiday, tour or work trip budget |
| Project / Reno | A build, renovation or one-off project |
| Start Blank | Two categories — add your own |

Categories can be added or removed per workspace, so a preset is a starting point
rather than a cage.

## Getting things in

- **Photo** — camera or gallery. Read on-device with OCR.
- **PDF invoice** — the text layer is read directly; scanned PDFs fall back to OCR.
- **CSV bank statement** — columns are detected automatically (date / amount, or
  separate debit and credit columns, with or without a header row) and each
  transaction is categorised from its description.
- **Paste or drag** an image onto the window.
- **Type it in** when there is no receipt.

Duplicates are flagged before they are saved.

## Getting things out

- CSV export of a workspace, for a spreadsheet or an accountant.
- JSON backup of every workspace. Receipt images stay on the device — the backup
  carries the records only, so it stays small enough to email.

## What is in the box

- Home: net position for the period, what is coming up, where the money went, recent records.
- Records: search, type and category filters, plus a month calendar view.
- Insights: six-month trend, full category breakdown, most-spent-with, CSV export.
- Dark mode, and an accent colour that follows the active workspace.
- Installable as a home-screen app; works offline once installed.

## Privacy

Receipts are read on the device — no image, file or record is ever uploaded.
Records live in IndexedDB in the browser.

The one thing fetched from the network is the OCR engine itself
([Tesseract.js](https://tesseract.projectnaptha.com/)) and the PDF reader
([pdf.js](https://mozilla.github.io/pdf.js/)), pulled from a CDN the first time you
scan and then cached for offline use. If they cannot be reached, the app says so and
attaches the photo to a blank record so nothing is lost.

## Running it

It is a static site with no build step.

```powershell
./serve.ps1        # http://localhost:3456
```

Or anything else that serves a directory:

```bash
npx http-server -p 3456 -c-1
```

Open it over `http://localhost` or HTTPS — the camera, the service worker and
IndexedDB all need a secure context, so opening `index.html` from the filesystem
will not work.

## Layout

```
index.html          app shell
styles.css          design tokens, light/dark, all components
sw.js               offline cache for the shell and the OCR engine
manifest.webmanifest
js/
  app.js            boot, routing, global events
  store.js          IndexedDB, workspaces, records, backup/restore, migration
  presets.js        workspace presets and their category packs
  extract.js        image prep, OCR, PDF text, receipt parsing
  csv.js            statement import, CSV export
  util.js           formatting, sheets, toasts
  views/            home, records, insights, more, form, capture, shared
```

Upgrading from the original Lifestyle Block Tracker is automatic: existing records
are moved into a Lifestyle Block workspace on first load, old category names are
remapped, and stored receipt photos are converted from base64 into blobs.
