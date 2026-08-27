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

- **Photo** — camera or gallery. The receipt's edges are found automatically and
  the photo is flattened into a straight-on scan before reading, so a shot taken
  at an angle comes out square. Corners can be dragged if the detection is off,
  and there is a rotate / re-detect / whole-photo escape hatch. The flattened
  result is then previewed with the clean-up set to Original, Light or Strong,
  and you can go back to the crop before committing. Turn the whole step off in
  Preferences if you would rather not be interrupted.
- **PDF invoice** — the text layer is read directly; scanned PDFs fall back to OCR.
  Each page is kept as an image so the invoice exports like any other receipt.
- **CSV bank statement** — columns are detected automatically (date / amount, or
  separate debit and credit columns, with or without a header row) and each
  transaction is categorised from its description.
- **Paste from the clipboard** — copy a receipt out of an email and paste it in,
  from the capture menu, the 📋 button on the home card, or Ctrl/Cmd+V anywhere.
  iOS asks permission with its own small "Paste" confirmation first; the app
  says so rather than leaving an unexplained bubble on screen, and if that
  prompt goes unanswered it falls back to a paste box after a few seconds.
- **Share to the app** — on Android, the app appears in the system share sheet,
  so a mail attachment can go straight in. Desktop Chrome can "Open with" it too.
- **Drag** a file onto the window.
- **Type it in** when there is no receipt.

Duplicates are flagged before they are saved.

**Suppliers are remembered.** Whatever you call a shop when you confirm a scan is
what the next scan of the same letterhead arrives with, category included, marked
"remembered" so you can see it was not read off the page. Because the same
letterhead rarely OCRs the same way twice, each supplier also keeps a few
distinctive words from the page and is matched on those when the name itself does
not line up. Names already used are offered as you type.

## Getting things out

- **Receipts as PDF** — one document holding a copy of every receipt, each on its
  own page with the date, shop, amount and tax printed above the image, behind a
  summary index that cross-references page numbers. Pick a period (month, quarter,
  year or everything) and it becomes the thing you hand to an accountant. Any
  single record can also be saved on its own from its detail sheet.
- **CSV export** of a workspace, for a spreadsheet.
- **JSON backup** of every workspace. This carries the records only — receipt
  images come out through the PDF export above, which keeps the backup small
  enough to email.

Receipts are stored as JPEG rather than PDF: it is roughly half the size for the
same page, and the PDF is generated on demand so it can carry the transaction
details alongside each image. The PDF writer is built in (`js/pdf.js`) with no
dependencies — JPEGs are embedded byte-for-byte via DCTDecode, so exporting is
lossless and works offline.

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
sw.js               offline cache for the shell and the OCR engine; also
                    receives shared files from the Android share sheet
manifest.webmanifest
js/
  app.js            boot, routing, global events
  store.js          IndexedDB, workspaces, records, backup/restore, migration
  presets.js        workspace presets and their category packs
  extract.js        image prep, OCR, PDF text, receipt parsing
  csv.js            statement import, CSV export
  clipboard.js      clipboard reads, with a manual paste-box fallback
  scan.js           document detection, perspective warp, lighting clean-up
  pdf.js            dependency-free PDF writer (Helvetica text + JPEG embedding)
  receipts.js       receipt-pack layout: index page plus one page per receipt
  export.js         delivering generated files (download, or share on mobile)
  util.js           formatting, sheets, toasts
  views/            home, records, insights, more, form, capture,
                    cropper, shared
```

Upgrading from the original Lifestyle Block Tracker is automatic: existing records
are moved into a Lifestyle Block workspace on first load, old category names are
remapped, and stored receipt photos are converted from base64 into blobs.
