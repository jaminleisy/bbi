# Builds.xlsx importer

This folder contains a one-off Python script that extracts every build from
`../Builds.xlsx` and emits a T-SQL script you can run against the
`BenBotInventory` database to bulk-load the data.

## Files

| File | What it is |
| --- | --- |
| `import_builds.py` | Reads `../Builds.xlsx`, extracts computers + parts, writes `builds_import.sql`. |
| `builds_import.sql` | Generated T-SQL: adds missing Sellers, then INSERTs Computers, Parts, and Payments in a single transaction. |
| `inspect_sheets.py` / `inspect_samples.py` / `discover.py` / `peek_row.py` / `date_stats.py` / `validate_sql.py` | Small utility scripts used to explore the workbook and sanity-check the generated SQL. Safe to delete once the import has been applied. |
| `test_mfr.py` | Small regression test for the manufacturer / model-shorthand parser. Run with `python test_mfr.py`. |

## Which sheets are read

`Builds`, `2025 Builds`, `2024 Builds`, and `Bulk 2026`.  `Bulk 2024` and
`Bulk 2025` are deliberately skipped: their rows have no status letter in
column 1 and, per the import spec, blank-status rows in the older sheets
are ignored.  The other sheets in the workbook (`Personal`, `Wages 2026`,
`Kept`, `ebay sales`, `Previous Builds`, `Old`, etc.) are ignored.

## What ends up in the database

For every build row that has a **status letter** in column 1 of a
*Builds* sheet:

* one row in **Computers** with `Type='PC'` and the parsed status
  (S -> `Sold`, L -> `Active`, B -> `Built`, T -> `Traded`, P -> `Planned`,
  M -> `Personal`). Monthly-tax summary rows (letter `M`, no parts filled,
  and `TAXES:` text in the trailing columns) are skipped.
  * `Computer.Name = "{case manufacturer} {case model} - {gpu model} ({row})"`
    (missing parts render as `?`; white cases append ` (white)` after the
    case model).
  * `Computer.Price` = **Actual Sell** when sold, else **Expected Sell**.
    Both sheet columns are tax-inclusive; `Computer.Tax` is the tax portion
    of that total (not added on top). When Actual differs from Expected on
    a sold row, Expected is kept in `OriginalPrice`.
  * `Computer.BuilderUserId` is derived from the Misc 3 and Note columns
    (see next section).
* one row in **Parts** per non-empty part cell, attached via `ComputerId`.
  Parts of a `Sold` computer additionally get `TestedDate = SoldDate` and
  `TestedUserId = BuilderUserId`.
* `Computer.BulkDesc` / `Computer.BulkCost` from the **Misc 3** column(s):
  * **Builds**: Misc 3 text → BulkDesc (Branden/Brandon clauses removed);
    Misc 3 $ → BulkCost minus $90 when Misc 3 mentions Branden (that $90
    is imported as a Wage instead).
  * **2025 Builds** / **2024 Builds**: Misc 3 packs price + description in
    one cell (e.g. `$9 winkey`); parsed into BulkCost + BulkDesc.
  * Misc 3 is **not** imported as inventory `Parts` rows.
* one row in **PartPlaceholders** when the part cell text contains `tbd`
  (case-insensitive word). These are planned slots, not inventory: the
  description is the sheet cell text with `tbd` removed. TBD cells on
  unassigned / bulk rows are skipped (placeholders require a computer).
* **Payments** for `Sold` computers: the sheet's **Paid / Actual Sell** cell
  is always the total paid. When the customer-info (`SOLD TO`) cell describes
  individual payments (e.g. `$100 deposit venmo 1-2 $1600 cash 1-6`) whose
  amounts sum to that Paid total, one `Payments` row is created per described
  payment (`deposit` / `payment` / `refund`, with method and date when
  present). Otherwise a single payment row is created for the Paid amount.
  `Tax` and the sheet **Fee** column are attached to the largest (or only)
  non-refund payment. Net paid is compared to `Computer.Price` (not price +
  tax) for fully-paid / Sold.

For rows that have **no status letter**:

* **`Builds` sheet** and **`Bulk 2026`**: parts are still parsed and
  inserted, but with `ComputerId = NULL` (they show up as unassigned
  inventory). Unassigned cells from the **Misc** / **Misc 2** columns are
  imported as type `ram` (not `misc`). Misc on a computer row stays `misc`.
* **`2024 Builds` / `2025 Builds`** (and, by extension, `Bulk 2024` /
  `Bulk 2025`, which are not read at all): the row is skipped entirely.

Every inserted `Computers` row has `[imported-from-Builds.xlsx]` in its
`Notes` column and every unassigned `Parts` row has the same tag in
its `Notes`, so the entire batch can be reverted with the deletes at the
top of `builds_import.sql`.

## Builder / location / user seeding

* `Part.Location`:
  * Italic info-cell text → `Josh` (always).
  * On the **Builds** sheet, unassigned parts on rows **269–329**
    (below line 268 and above line 330) → `Josh`.
  * All other unassigned parts, and parts on builds (sold or unsold) →
    `Ben`, unless italic → `Josh`.
  * `IF NOT EXISTS` inserts guarantee both `Locations` rows exist before
    parts are inserted.
* `Computer.BuilderUserId` is chosen with the following priority
  (case-insensitive substring match):
    1. Misc 3 column contains `branden` -> `Branden J`
    2. Note column contains `joshua` or `joshy` -> `Joshua L`
    3. Note column contains `danny` or `daniel` -> `Daniel L`
    4. Note column contains `josh_t` -> `Ben+Josh`
    5. Note column contains `josh_s` or `josh` -> `Josh B`
    6. otherwise -> `Ben L`
* Six placeholder `Users` rows (`Ben L`, `Branden J`, `Joshua L`,
  `Daniel L`, `Ben+Josh`, `Josh B`) are inserted `IF NOT EXISTS` with an
  empty `PasswordHash` (so they can't log in until you set one).

## Assumptions the parser makes

* Part cell format is `"<model info> (<seller>) <M-D[-YY[YY]]>[ *extra]"`.
  A leading `*B*` sets `Parts.Bad = 1` (possibly bad); a leading `*S*` sets
  `Parts.Scam = 1` (possibly scam). Those prefixes are stripped from the
  stored model text. (`2` = confirmed is reserved for manual use.)
  A `yt` token anywhere in the model text = white; anything after the date
  (with the conventional leading `*` stripped) becomes `Part.Notes`.
* Price-cell links become `Part.OrderUrl`: native Excel hyperlinks and
  `=HYPERLINK("url", price)` formulas (the formula's second argument is
  used as `Part.Cost`).
* Manufacturer is extracted out of the model text and stored in
  `Part.Manufacturer`. Shorthand is expanded to the canonical name
  (`dflash -> darkFlash`, `gbyte -> Gigabyte`, `th-righ/th-right ->
  Thermalright`, `clrmstr/clmstr -> Cooler Master`, `wd -> Western Digital`,
  `deepcool -> DeepCool`,
  `sp/siliconpower -> Silicon Power`, `sung -> Samsung`,
  `tgroup/Team Group -> TeamGroup`, `ID-C -> ID Cooling`,
  `G Skill/G Skil -> G.Skill`, etc.). Full-name variants
  (`Thermalright`, `Gigabyte`, `Cooler Master`, `Western Digital`, ...)
  are also recognised. The alias is removed from the resulting model
  number.
* If the model contains no known manufacturer alias, a few
  product-line fallbacks apply: `T-Force`/`T-Create` -> `TeamGroup`,
  `Omen` -> `HP`, `rog strix`/`tuf` -> `ASUS`,
  `Aorus` -> `Gigabyte`, `XLR8` -> `PNY`,
  `Trident`/`Trident Z` -> `G.Skill`,
  `steelegend`/`Steel Legend` -> `ASRock`, `ftw3` -> `EVGA`,
  `wraith`/`ryzen stock` -> `AMD`, and
  `fe` -> `Nvidia` (and `fe` is expanded to `Founders Edition` in the
  model). Unlike regular aliases, the matched product-line text is
  kept in the model so the line-name info isn't lost.  The `sl`
  shorthand is expanded to `Steel Legend` in the model text (which
  then triggers the ASRock fallback).
* For CPU parts that end up with no manufacturer, an AMD/Intel
  heuristic is applied to the model text: explicit keywords
  (`ryzen`/`athlon`/`threadripper`/`epyc` -> AMD;
  `intel`/`core`/`i3`/`i5`/`i7`/`i9`/`pentium`/`xeon`/`celeron` ->
  Intel), a `x3d`/`xt` suffix -> AMD, `fx-####` / `aN-####` -> AMD,
  `G####` -> Intel, 5-digit models `1[0-4]####` (with optional
  `k`/`kf`/`f`/`t` suffix) -> Intel, 4-digit + `k`/`kf`/`ks`/`ke`/`t`
  -> Intel, 4-digit + `x`/`g`/`f`/`ge` -> AMD, and finally a bare
  4-digit model starting `1`/`2`/`3`/`5`/`7`/`8`/`9` -> AMD (the
  Ryzen 1000/2000/3000/5000/7000/8000/9000 convention).
* Model-shorthand tokens are expanded in the stored model number, e.g.
  `fi -> Frozen Infinity`, `fw/fwU/fn -> Frozen Warframe / Warframe Ultra
  / Notte`, `asdigital -> Assasin Digital`, `lf2/lfII/lf3 -> Liquid
  Freezer II/II/III`, `gv -> Grand Vision`, `hyp212 -> Hyper 212`,
  `aev5/aev6 -> Aqua Elite V5/V6`, `domin8 -> Dominator`, `rj ->
  Ripjaws`, `triz -> Trident Z`, `vent/vent2x/vent3x -> Ventus/2x/3x`,
  `gam/gamx/gamtrio/gamxtrio -> Gaming/Gaming X/Trio/X Trio`,
  `apoc -> Apocalypse`, `twr250/twr300 -> Tower 250/300`,
  `sl -> Steel Legend`.
* Seller shorthand is canonicalised:
  * `bay -> eBay`, `amz -> Amazon`, `neg -> Newegg`,
    `woot -> Woot`, `bb/bhp -> Best Buy`, `wm -> Walmart`,
    `fb/facebook -> Facebook Marketplace`,
    `msi -> MSI`, `zotac -> Zotac`, `nvidia -> Nvidia`, `hyte -> Hyte`,
    `pp/paypal -> PayPal`, `cdkeys -> CDKeys`, `keysoff -> KeysOff`,
    `jawa -> Jawa`, `pirate/pirateship -> Pirate Ship`,
  * anything starting with `loc*`, `local*`, or `loj*` -> `Local`,
  * everything else -> `Other`.
* Part order dates without a year get the same year as the row's sale
  date, unless the part month is later in the year than the sale month
  (then previous year). For rows without a sale date the current month is
  used as the reference.
* `SoldDate` = the sheet's Sale Date cell. Far-future placeholder dates
  (2030-10-10) are treated as "not yet sold".
* Customer info is parsed out of the `SOLD TO` cell: first chunk (before
  URLs / `$` / phone) is the `CustomerName`, the first non-Messenger /
  non-business Facebook URL is `CustomerUrl`, the first Messenger URL is
  `ConversationUrl` (falling back to a `business.facebook.com` URL when
  no Messenger link is present), and the full cell is preserved verbatim
  in `CustomerInfo`.
* Cell font italicness controls `Part.Location` (`italic -> 'Josh'`,
  otherwise `'Ben'`).  These are the only two locations produced by the
  importer.
* `Part.Condition` defaults to `Used` when the seller is eBay, otherwise
  `New`.

## How to run it

1. Make sure the BenBotInventory server has been started once so the
   database, tables, and lookup seed data exist (`cd Server && dotnet run`).
   You can stop the server before importing.
2. Regenerate the SQL if you have edits to make:
   ```
   cd C:\BenBotInventory\ImportScripts
   pip install openpyxl        # first time only
   python import_builds.py
   ```
   This overwrites `builds_import.sql` and prints a summary.
3. Apply the SQL against the database:
   ```
   sqlcmd -S "(localdb)\MSSQLLocalDB" -d BenBotInventory ^
          -i C:\BenBotInventory\ImportScripts\builds_import.sql
   ```
   or open `builds_import.sql` in SSMS and hit F5. The whole thing runs
   inside a single `BEGIN TRAN ... COMMIT`, so a failure rolls the whole
   import back.

## Wages

Only the **Builds** sheet contributes `Wages` rows. Each wage is linked to
its computer via `ComputerId`:

* **Josh B** — columns AI–AL (note, amount, PaidDate, PaidMethod). Method
  shorthand is canonicalised (`zelle` → `Zelle`, etc.).
* **Branden J** — any Misc 3 cell containing `brandon` or `branden` →
  Amount `$90`, PaidMethod `Cash App`, Notes = computer name, PaidDate =
  sale date minus 3 days (null if the PC has no sale date).

## Reverting

```
USE BenBotInventory;
DELETE FROM Parts    WHERE Notes LIKE '%[imported-from-Builds.xlsx]%'
    OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%[imported-from-Builds.xlsx]%');
DELETE FROM Payments WHERE ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%[imported-from-Builds.xlsx]%');
DELETE FROM Wages     WHERE Notes LIKE '%[imported-from-Builds.xlsx]%'
    OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%[imported-from-Builds.xlsx]%');
DELETE FROM PartPlaceholders WHERE ComputerId IN (
    SELECT Id FROM Computers WHERE Notes LIKE '%[imported-from-Builds.xlsx]%');
DELETE FROM Computers WHERE Notes LIKE '%[imported-from-Builds.xlsx]%';
```

## Current import size

Regenerating on the workbook I was given produces:

| Sheet | Computers | Parts (assigned) | Parts (unassigned) | Payments |
| --- | ---: | ---: | ---: | ---: |
| 2024 Builds | 257 | 1934 | - | 256 |
| 2025 Builds | 312 | 2303 | - | 311 |
| Bulk 2026 | - | - | 36 | - |
| Builds (2026) | 173 | 1238 | 560 | 144 |
| **Total** | **742** | **5475** | **596** | **711** |

The script also `IF NOT EXISTS`-inserts the seller names it uses
(`Amazon`, `Best Buy`, `CDKeys`, `eBay`, `Facebook Marketplace`, `Hyte`,
`Jawa`, `KeysOff`, `Local`, `MSI`, `Newegg`, `Nvidia`, `Other`, `PayPal`,
`Pirate Ship`, `Walmart`, `Woot`, `Zotac`), so any that were already in
the seed data are left alone.
