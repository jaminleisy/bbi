"""
Import Ben's Builds.xlsx into BenBotInventory-shaped SQL Server INSERTs.

Reads six sheets from ../Builds.xlsx:

    Builds       (current year - 2026)
    Bulk 2026    (loose parts for 2026)
    2025 Builds  (sold builds in 2025)
    Bulk 2025    (loose parts for 2025)
    2024 Builds  (sold builds in 2024)
    Bulk 2024    (loose parts for 2024)

...and emits a T-SQL script `builds_import.sql` that:

  1. Adds any missing Sellers referenced by the data.
  2. Inserts one Computers row per build row (Type='PC') or one Type='Parts'
     computer per Bulk sheet.
  3. Inserts one Parts row per non-empty part cell, attached to its computer.
  4. Inserts Payment row(s) for sold computers. Spreadsheet sell prices are
     tax-inclusive; the Paid/Actual Sell cell is the total. When customer
     info describes payments that sum to that total, one Payments row is
     emitted per described payment; otherwise a single payment uses the
     Paid amount. Payment.Tax is the tax portion (not added on top).

Assumptions (documented in the emitted .sql header too):

  * First-column status letters (Proper-cased values written to the DB):
        S -> Sold, L -> Active, B -> Built, T -> Traded,
        P -> Planned, M -> Personal. Blank-status rows are not computers
        (see import_unassigned sheet flag). Monthly-tax summary rows
        (letter=M, no part cells filled, and TAX text in the trailing
        summary columns) are skipped.
  * Part cell format:   "[*B*|*S*]<model info> (<seller>) <M-D[-YY[YY]]>[ extra notes]"
      - Leading *B* → Bad=1 (possibly bad); leading *S* → Scam=1 (possibly scam).
      - "yt" token anywhere in the model text = white color.
      - Everything after the date goes into a note (dropped for now; part
        entity has no Notes column, so notable info is folded into the
        computer's Notes when it looks material).
      - A hyperlink on the price cell (native link or =HYPERLINK("url", price)
        formula) becomes Part.OrderUrl; the formula's second arg is the cost.
  * Seller shorthand is canonicalised (amz->Amazon, bay->eBay, neg->Facebook
    Marketplace, woot->Woot, bb->Best Buy, wm->Walmart, msi/zotac/nvidia/hyte
    added as new sellers, loc*/local* -> Local, unknown -> Other, etc.).
  * Sale Date comes from the sheet's `Sale Date` datetime cell.
  * Part order dates without a year: assume the same year as the row's sale
    date, unless the part month is later in the calendar year than the sale
    month, in which case it was ordered the previous year.
  * Bulk sheets get a single 'Parts' computer named "Bulk Parts YYYY" with
    every part in the sheet attached to it.
  * Computer.Name defaults to the parsed customer first name (+ last), or
    falls back to "<Sheet> row <N>".

Usage:
    python import_builds.py
    # writes builds_import.sql next to this script

Then in SSMS (against the BenBotInventory database):
    :r C:\\BenBotInventory\\ImportScripts\\builds_import.sql
or from the command line:
    sqlcmd -S "(localdb)\\MSSQLLocalDB" -d BenBotInventory -i builds_import.sql
"""

from __future__ import annotations

import datetime as dt
import os
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

import openpyxl
from openpyxl.cell.cell import Cell
from openpyxl.worksheet.worksheet import Worksheet

# ---------------------------------------------------------------------------
# Paths / configuration
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
WORKBOOK_PATH = os.path.abspath(os.path.join(HERE, "..", "Builds.xlsx"))
OUTPUT_SQL_PATH = os.path.join(HERE, "builds_import.sql")

# Note text used to tag every inserted row so the whole batch can be undone
# with a single DELETE.  Change if you re-run the importer more than once.
IMPORT_TAG = "[imported-from-Builds.xlsx]"

# ---------------------------------------------------------------------------
# Sheet layouts
# ---------------------------------------------------------------------------
#
# Every sheet uses the same first 22 columns for parts:
#   3,4  -> case      (name, price)
#   5,6  -> psu
#   7,8  -> gpu
#   9,10 -> mobo
#  11,12 -> cpu
#  13,14 -> cpuCooler
#  15,16 -> storage
#  17,18 -> ram
#  19,20 -> misc
#  21,22 -> misc (second slot)
# Some sheets have a "Misc 3" pair at 23,24. The trailing columns for sale
# price / tax / SOLD TO differ.
#
# The tables below encode the sheet-specific bits. Missing keys are treated
# as None (i.e. the sheet doesn't have that column).

BUILD_PART_PAIRS = [
    ("case",       3,  4),
    ("psu",        5,  6),
    ("gpu",        7,  8),
    ("mobo",       9, 10),
    ("cpu",       11, 12),
    ("cpuCooler", 13, 14),
    ("storage",   15, 16),
    ("ram",       17, 18),
]

# Misc / Misc 2 as inventory "misc" parts. Misc 3 is Computer.BulkDesc/BulkCost
# (not a Part row) — see parse_bulk_misc3().
BUILD_MISC_PAIRS        = [(19, 20), (21, 22)]
BULK_MISC_PAIRS         = [(19, 20), (21, 22)]

# Branden Misc 3 wage amount — subtracted from BulkCost when Misc 3 mentions him.
BRANDEN_MISC3_WAGE = 90.0

# Builds sheet: unassigned parts on rows strictly below 268 and strictly above
# 330 (i.e. rows 269–329) always get Location = Josh.
BUILDS_UNASSIGNED_JOSH_ROW_AFTER = 268
BUILDS_UNASSIGNED_JOSH_ROW_BEFORE = 330

SHEET_CONFIG = {
    # ------- Builds (current, 2026) -------
    "Builds": {
        "kind": "builds",
        "year": 2026,
        "part_pairs": BUILD_PART_PAIRS + [("misc", a, b) for a, b in BUILD_MISC_PAIRS],
        "col_status":         1,
        "col_note":           2,
        "col_expected_sell": 26,
        "col_actual_sell":   27,
        "col_payment_method":28,
        "col_tax":           29,
        "col_fee":           30,
        "col_sale_date":     31,
        "col_sold_to":       34,
        "col_josh_split":    35,   # also the Josh wage note (col AI)
        "col_misc3":         23,
        "col_misc3_dollar":  24,   # Misc 3 $ → BulkCost (minus Branden wage)
        # Josh wage payouts: AI=note, AJ=amount, AK=PaidDate, AL=PaidMethod
        "col_wage_note":     35,
        "col_wage_amount":   36,
        "col_wage_date":     37,
        "col_wage_method":   38,
        # Rows with no letter in col 1 are imported as unassigned parts
        # (Part.ComputerId = NULL) rather than a Type='PC' computer.
        "import_unassigned": True,
        # Only the Builds sheet contributes Wages rows.
        "import_wages": True,
    },
    "2025 Builds": {
        "kind": "builds",
        "year": 2025,
        "part_pairs": BUILD_PART_PAIRS + [("misc", a, b) for a, b in BUILD_MISC_PAIRS],
        "col_status":         1,
        "col_note":           2,
        "col_expected_sell": 25,
        "col_actual_sell":   26,
        "col_payment_method":27,
        "col_tax":           28,
        "col_fee":           29,
        "col_sale_date":     30,
        "col_sold_to":       32,
        "col_josh_split":    33,
        "col_misc3":         23,
        # 2025 Misc 3 packs "$amount description" in one cell (no Misc 3 $ col).
        "misc3_combined":    True,
        "import_unassigned": False,
    },
    "2024 Builds": {
        "kind": "builds",
        "year": 2024,
        "part_pairs": BUILD_PART_PAIRS + [("misc", a, b) for a, b in BUILD_MISC_PAIRS],
        "col_status":         1,
        "col_note":           2,
        "col_expected_sell": 25,
        "col_actual_sell":   26,
        "col_tax":           28,
        "col_tax_already_paid":29,
        "col_fee":           31,
        "col_sale_date":     32,
        "col_sold_to":       36,
        "col_josh_split":    37,
        "col_payment_method":40,
        "col_misc3":         23,
        "misc3_combined":    True,
        "import_unassigned": False,
    },
    # ------- Bulk 2026 (unassigned parts for the current year) -------
    "Bulk 2026": {
        "kind": "bulk",
        "year": 2026,
        "part_pairs": BUILD_PART_PAIRS + [("misc", a, b) for a, b in BULK_MISC_PAIRS],
        "col_note": 2,
        "col_sale_date": 29,
    },
    # Bulk 2024 / Bulk 2025 are intentionally omitted - per the spec, rows
    # without a status letter in older sheets are ignored, and every row in
    # those bulk sheets falls in that bucket.
}

# Order matters: process oldest first so IDs grow chronologically.
SHEET_ORDER = ["2024 Builds", "2025 Builds", "Bulk 2026", "Builds"]

# ---------------------------------------------------------------------------
# Status letter -> Computer.Status
# ---------------------------------------------------------------------------

STATUS_MAP = {
    "S": "Sold",
    "L": "Active",
    "B": "Built",
    "T": "Traded",
    "P": "Planned",
    "M": "Personal",
    "F": "Planned",     # only appears as the 2025 Builds header row artefact
    "":  "Planned",
    None:"Planned",
}

# ---------------------------------------------------------------------------
# Seller canonicalisation
# ---------------------------------------------------------------------------

_SELLER_MAP: dict[str, str] = {
    "bay":  "eBay",
    "amz":  "Amazon",
    "neg":  "Newegg",
    "woot": "Woot",
    "wootk":"Woot",
    "bb":   "Best Buy",
    "bbuy": "Best Buy",
    "bhp":  "Best Buy",
    "wm":   "Walmart",
    "msi":  "MSI",
    "zotac":"Zotac",
    "nvidia":"Nvidia",
    "nvidia.com":"Nvidia",
    "hyte": "Hyte",
    "pp":   "PayPal",
    "paypal":"PayPal",
    "fb":   "Facebook Marketplace",
    "facebook": "Facebook Marketplace",
    "cdkeys":"CDKeys",
    "keysoff":"KeysOff",
    "jawa": "Jawa",
    "pirate":"Pirate Ship",
    "pirateship":"Pirate Ship",
    "pirate ship":"Pirate Ship",
    "unknown":"Other",
    "free": "Other",
    "spare":"Other",
    "gift": "Other",
    "trade":"Local",
    "with cpu":"Other",
    "from combo":"Other",
    "from my traded pc":"Local",
    "local":"Local",
    "local trade":"Local",
    "mark": "Local",
    "mark-maddie":"Local",
    "austin":"Local",
    "brantley":"Local",
    "antphil":"Local",
    "alienware":"Local",
    "trade6800":"Local",
    "loc":  "Local",
}


def canonical_seller(raw: Optional[str]) -> Optional[str]:
    """Convert a raw parenthetical seller code to a canonical seller name.

    Returns None if `raw` is blank.
    Unmapped codes that start with 'loc' (or 'local') collapse to 'Local'.
    Everything else defaults to 'Other'."""
    if not raw:
        return None
    key = raw.strip().lower()
    if not key:
        return None
    if key in _SELLER_MAP:
        return _SELLER_MAP[key]
    if key.startswith("loc") or key.startswith("local") or key.startswith("loj"):
        return "Local"
    return "Other"


# ---------------------------------------------------------------------------
# Manufacturer extraction + model-shorthand expansion
# ---------------------------------------------------------------------------
#
# Model strings in the sheet frequently start with a manufacturer name,
# often as shorthand ("dflash" for darkFlash, "gbyte" for Gigabyte).  The
# parser pulls that name out into Part.Manufacturer and removes it from the
# model text.  Longer aliases are tried first so "Samsung" beats "sung",
# "TeamGroup" beats "tgroup", etc.

_MFR_ALIASES: list[tuple[str, str]] = [
    # shorthand -> canonical name
    ("th-righ",       "Thermalright"),
    ("th-right",      "Thermalright"),   # sheet uses both spellings; the second matches ~368 parts
    ("Thermalright",  "Thermalright"),   # full-name variant, in case the sheet spells it out
    ("th-take",       "Thermaltake"),
    ("Thermaltake",   "Thermaltake"),
    ("gbyte",         "Gigabyte"),
    ("gybte",         "Gigabyte"),       # common typo of 'gbyte' in the sheet
    ("Gigabyte",      "Gigabyte"),
    ("dflash",         "darkFlash"),
    ("darkFlash",      "darkFlash"),
    ("clrmstr",        "Cooler Master"),
    ("clmstr",         "Cooler Master"),   # sheet spelling variant of 'clrmstr'
    ("Cooler Master",  "Cooler Master"),
    ("pcclr",          "PCCOOLER"),
    ("mont",           "Montech"),
    ("radmax",         "Raidmax"),
    ("tgroup",         "TeamGroup"),
    ("sung",           "Samsung"),
    ("wd",             "Western Digital"),
    ("Western Digital","Western Digital"),
    ("sp",             "Silicon Power"),
    ("ID-C",           "ID Cooling"),
    ("ID Cooling",     "ID Cooling"),
    ("G Skill",        "G.Skill"),
    ("G Skil",         "G.Skill"),         # sheet spelling variant of 'G Skill'
    ("G.Skill",        "G.Skill"),
    ("Team Group",     "TeamGroup"),
    # canonical / explicit spellings
    ("Asus",      "ASUS"),
    ("MSI",       "MSI"),
    ("PCCOOLER",  "PCCOOLER"),
    ("Samsung",   "Samsung"),
    ("Toshiba",   "Toshiba"),
    ("Inland",    "Inland"),
    ("Kioxia",    "Kioxia"),
    ("Sabrent",   "Sabrent"),
    ("Zotac",     "Zotac"),
    ("PNY",       "PNY"),
    ("Zalman",    "Zalman"),
    ("Lian Li",   "Lian Li"),
    ("HYTE",      "HYTE"),
    ("DIYPC",     "DIYPC"),
    ("Montech",   "Montech"),
    ("Corsair",   "Corsair"),
    ("Raidmax",   "Raidmax"),
    ("Jonsvo",    "Jonsvo"),
    ("Jonsbo",    "Jonsbo"),
    ("SAMA",      "SAMA"),
    ("SSUPD",     "SSUPD"),
    ("Okinos",    "Okinos"),
    ("Musetex",   "Musetex"),
    ("Antec",     "Antec"),
    ("Kediers",   "Kediers"),
    ("Mannajue",  "Mannajue"),
    ("Rosewill",  "Rosewill"),
    ("EVGA",      "EVGA"),
    ("Gamemax",   "Gamemax"),
    ("Gamdias",   "Gamdias"),
    ("XPG",       "XPG"),
    ("Arctic",    "Arctic"),
    ("upHere",    "upHere"),
    ("ASRock",    "ASRock"),
    ("ESGaming",  "ESGaming"),
    ("Acer",      "Acer"),
    ("NZXT",      "NZXT"),
    ("Micron",    "Micron"),
    ("SK Hynix",  "SK Hynix"),
    ("TeamGroup", "TeamGroup"),
    ("V-Color",   "V-Color"),
    ("Kingston",  "Kingston"),
    ("Oloy",      "Oloy"),
    ("EK",        "EK"),
    ("HP",        "HP"),
    ("Kalemax",   "Kalemax"),
    ("AGI",       "AGI"),
    # Added after the first import pass, once these brands were spotted in
    # NULL-manufacturer rows.  Product lines (Aorus / XLR8 / Trident) live
    # in the special-fallback table below so the line name is preserved in
    # the model number.
    ("Crucial",       "Crucial"),
    ("Segotep",       "Segotep"),
    ("Patriot",       "Patriot"),
    ("Cougar",        "Cougar"),
    ("Redragon",      "Redragon"),
    ("Apevia",        "Apevia"),
    ("Lexar",         "Lexar"),
    ("siliconpower",  "Silicon Power"),   # sheet spelling (one word)
    ("Silicon Power", "Silicon Power"),
    ("Alienware",     "Alienware"),
    ("Solidigm",      "Solidigm"),
    ("Timetec",       "Timetec"),
    # Round 3
    ("Seasonic",      "Seasonic"),
    ("Aresgame",      "Aresgame"),
    ("Neo Forza",     "Neo Forza"),
    ("Mushkin",       "Mushkin"),
    ("Zadek",         "Zadek"),
    ("SZSKYING",      "SZSKYING"),
    ("Acclamator",    "Acclamator"),
    ("Fuzedrive",     "Fuzedrive"),
    ("Intel",         "Intel"),
    # Round 4
    ("deepcool",      "DeepCool"),
    ("DeepCool",      "DeepCool"),
    ("Dracena",       "Dracena"),
    ("Allied",        "Allied"),
]

_MFR_ALIASES_RE: list[tuple[re.Pattern, str]] = [
    (re.compile(rf"\b{re.escape(alias)}\b", re.IGNORECASE), canonical)
    for alias, canonical in sorted(_MFR_ALIASES, key=lambda t: -len(t[0]))
]


def extract_manufacturer(model: str) -> tuple[str, Optional[str]]:
    """Find and remove the first known manufacturer alias in `model`.

    Returns ``(updated_model, canonical_manufacturer_or_None)``.
    """
    for pat, canonical in _MFR_ALIASES_RE:
        m = pat.search(model)
        if m:
            new = model[:m.start()] + model[m.end():]
            new = re.sub(r"\s+", " ", new).strip(" ,-")
            return new, canonical
    return model, None


# When no known manufacturer alias is present, certain product-line tokens
# still imply a manufacturer.  The matched text is kept in the model
# (except "fe", which is expanded to "Founders Edition").
# Order matters: return on first match, so more specific patterns first.
_SPECIAL_FALLBACKS: list[tuple[re.Pattern, str, Optional[str]]] = [
    # Multi-word / more-specific patterns first
    (re.compile(r"\bryzen\s+stock\b",  re.IGNORECASE), "AMD",       None),
    (re.compile(r"\brog\s+strix\b",    re.IGNORECASE), "ASUS",      None),
    (re.compile(r"\btrident\s+z\b",    re.IGNORECASE), "G.Skill",   None),
    (re.compile(r"\bsteel\s+legend\b", re.IGNORECASE), "ASRock",    None),
    (re.compile(r"\bt-force\b",        re.IGNORECASE), "TeamGroup", None),
    (re.compile(r"\bt-create\b",       re.IGNORECASE), "TeamGroup", None),
    # Single-word product lines
    (re.compile(r"\bomen\b",           re.IGNORECASE), "HP",        None),
    (re.compile(r"\baorus\b",          re.IGNORECASE), "Gigabyte",  None),
    (re.compile(r"\bxlr8\b",           re.IGNORECASE), "PNY",       None),
    (re.compile(r"\btrident\b",        re.IGNORECASE), "G.Skill",   None),
    (re.compile(r"\btuf\b",            re.IGNORECASE), "ASUS",      None),
    (re.compile(r"\bsteelegend\b",     re.IGNORECASE), "ASRock",    None),
    (re.compile(r"\bftw3\b",           re.IGNORECASE), "EVGA",      None),
    (re.compile(r"\bwraith\b",         re.IGNORECASE), "AMD",       None),
    # Very short tokens last (higher risk of false positives)
    (re.compile(r"\bfe\b",             re.IGNORECASE), "Nvidia",    "Founders Edition"),
]


def apply_special_fallback(model: str) -> tuple[str, Optional[str]]:
    for pat, mfr, replacement in _SPECIAL_FALLBACKS:
        m = pat.search(model)
        if m:
            if replacement is not None:
                model = pat.sub(replacement, model)
            return model, mfr
    return model, None


# Model-shorthand expansions applied after manufacturer extraction.
# Longer keys are tried first so e.g. "vent2x" doesn't get eaten by "vent".
_MODEL_SHORTHAND: list[tuple[str, str]] = [
    ("fi",        "Frozen Infinity"),
    ("fwU",       "Frozen Warframe Ultra"),
    ("fw",        "Frozen Warframe"),
    ("fn",        "Frozen Notte"),
    ("asdigital", "Assasin Digital"),
    ("lfII",      "Liquid Freezer II"),
    ("lf2",       "Liquid Freezer II"),
    ("lf3",       "Liquid Freezer III"),
    ("gv",        "Grand Vision"),
    ("hyp212",    "Hyper 212"),
    ("aev5",      "Aqua Elite V5"),
    ("aev6",      "Aqua Elite V6"),
    ("domin8",    "Dominator"),
    ("rj",        "Ripjaws"),
    ("triz",      "Trident Z"),
    ("vent2x",    "Ventus 2x"),
    ("vent3x",    "Ventus 3x"),
    ("vent",      "Ventus"),
    ("gamxtrio",  "Gaming X Trio"),
    ("gamtrio",   "Gaming Trio"),
    ("gamplus",   "Gaming Plus"),
    ("gamx",      "Gaming X"),
    ("apoc",      "Apocalypse"),
    ("gam",       "Gaming"),
    ("shad3x",    "Shadow 3x"),
    ("shad2x",    "Shadow 3x"),  # sheet spelling; expands to Shadow 3x
    ("twr250",    "Tower 250"),
    ("twr300",    "Tower 300"),
    ("twr",       "Tower"),
    ("sl",        "Steel Legend"),   # ASRock's Steel Legend line; also implies manufacturer via fallback
]

_MODEL_SHORTHAND_RE: list[tuple[re.Pattern, str]] = [
    (re.compile(rf"\b{re.escape(short)}\b", re.IGNORECASE), full)
    for short, full in sorted(_MODEL_SHORTHAND, key=lambda t: -len(t[0]))
]


def expand_model_shorthand(model: str) -> str:
    for pat, full in _MODEL_SHORTHAND_RE:
        model = pat.sub(full, model)
    return re.sub(r"\s+", " ", model).strip()


# Heuristics used only for CPU parts that ended up with no manufacturer
# after alias / fallback matching.  Rules are checked in priority order.
_CPU_RULES: list[tuple[re.Pattern, str]] = [
    # Explicit brand keywords
    (re.compile(r"\b(ryzen|athlon|threadripper|epyc|amd)\b", re.IGNORECASE), "AMD"),
    (re.compile(r"\b(intel|core|pentium|xeon|celeron)\b",   re.IGNORECASE), "Intel"),
    (re.compile(r"\bi[3579]\b",                              re.IGNORECASE), "Intel"),
    # AMD "X3D" / "XT" suffix on any 3-5 digit model
    (re.compile(r"\b\d{3,5}(?:x3d|xt)\b",                    re.IGNORECASE), "AMD"),
    # AMD FX / A-series APU prefixes
    (re.compile(r"\bfx-?\d{3,4}\b",                          re.IGNORECASE), "AMD"),
    (re.compile(r"\ba\d-\d{4}\b",                            re.IGNORECASE), "AMD"),
    # Intel Pentium Gold "G6900" style
    (re.compile(r"\bg\d{4}\b",                               re.IGNORECASE), "Intel"),
    # Intel Core 10th-14th gen: 5-digit model (with optional K/F/T suffix)
    (re.compile(r"\b1[0-4]\d{3}[a-z]{0,3}\b",                re.IGNORECASE), "Intel"),
    # 4-digit + Intel K/KF/KS/KE/T suffix (older Intel Core generations)
    (re.compile(r"\b\d{4}(?:kf|ks|ke|k|t)\b",                re.IGNORECASE), "Intel"),
    # 4-digit + AMD suffix (X, G, F, GE)
    (re.compile(r"\b\d{4}(?:x|ge|g|f)\b",                    re.IGNORECASE), "AMD"),
    # Bare 4-digit model starting 1/2/3/5/7/8/9: AMD Ryzen convention
    # (Intel's older 4-digit models are always paired with an "i5/i7"
    #  prefix in the sheet, so those are caught by the keyword rule above).
    (re.compile(r"\b[1235789]\d{3}\b",                       re.IGNORECASE), "AMD"),
]


def infer_cpu_manufacturer(model: Optional[str]) -> Optional[str]:
    """Guess a CPU's manufacturer from its model text.

    Returns "Intel" / "AMD" or None if no rule matches.  Only called for
    CPU parts that didn't match any manufacturer alias.
    """
    if not model:
        return None
    for pat, mfr in _CPU_RULES:
        if pat.search(model):
            return mfr
    return None


# ---------------------------------------------------------------------------
# Cell parsers
# ---------------------------------------------------------------------------

# Matches "(seller)" then optional whitespace, then a date "M-D" / "M/D" /
# "M-D-YY" / "M-D-YYYY". Anything after that = notes. Anything before = model.
_PART_RE = re.compile(
    r"""^
        (?P<model>.*?)                 # model text (lazy)
        \s*
        \(\s*(?P<seller>[^)]{1,60})\s*\)   # (seller)
        \s*
        (?P<date>\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)?  # optional date
        \s*
        (?P<extra>.*)$                 # trailing notes (may be empty)
    """,
    re.DOTALL | re.VERBOSE,
)

_DATE_RE = re.compile(r"^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$")


def parse_part_date(text: str, sale_year: int, sale_month: int) -> Optional[dt.date]:
    """Parse a shorthand date like '11-26' / '1/3' / '4-26-24' / '2-3-2025'.

    If the year is omitted, guess it from the sale date: same year unless the
    part month is later in the year than the sale month (then previous year)."""
    if not text:
        return None
    m = _DATE_RE.match(text.strip())
    if not m:
        return None
    mo, da, yr = int(m.group(1)), int(m.group(2)), m.group(3)
    if yr:
        y = int(yr)
        if y < 100:
            y += 2000
    else:
        y = sale_year if mo <= sale_month else sale_year - 1
    try:
        return dt.date(y, mo, da)
    except ValueError:
        return None


_TBD_TOKEN_RE = re.compile(r"\btbd\b", re.IGNORECASE)


def is_tbd_part_text(text: str) -> bool:
    """True when the sheet cell name contains a 'tbd' token (planned, not purchased)."""
    return bool(_TBD_TOKEN_RE.search(text or ""))


def placeholder_description_from_sheet(sheet_name: str) -> str:
    """Sheet cell text with 'tbd' removed — used as PartPlaceholder.Description."""
    text = _TBD_TOKEN_RE.sub("", sheet_name or "")
    text = re.sub(r"\s+", " ", text).strip(" ,;-/")
    if not text:
        text = "planned"
    return text[:200]


@dataclass
class ParsedPart:
    """Result of parsing a part-info cell + its price cell."""
    part_type: str
    manufacturer: Optional[str]
    model_number: Optional[str]
    seller: Optional[str]
    order_date: Optional[dt.date]
    color: Optional[str]
    cost: Optional[float]
    order_url: Optional[str]
    extra_note: Optional[str]         # free-text after date (may be long)
    raw_info: str                     # original info-cell text
    location: Optional[str] = None    # "Ben" or "Josh" (see resolve_part_location)
    tested_date: Optional[dt.date] = None
    tested_user_id: Optional[str] = None
    condition: Optional[str] = None   # "Used" for eBay, else "New"
    bad: Optional[int] = None         # 1 = possibly bad, 2 = confirmed bad
    scam: Optional[int] = None        # 1 = possibly scam, 2 = confirmed scam


@dataclass
class PlaceholderRecord:
    """Planned part slot from a sheet cell containing 'tbd'."""
    part_type: str
    description: str


def _is_italic(cell: Optional[Cell]) -> bool:
    """True when the given cell's font is italic (openpyxl reports it on
    ``cell.font.italic`` regardless of ``data_only`` mode)."""
    if cell is None:
        return False
    font = cell.font
    return bool(font is not None and font.italic)


def resolve_part_location(
    info_cell: Optional[Cell],
    *,
    sheet_name: str,
    row: int,
    unassigned: bool,
) -> str:
    """Choose Part.Location.

    Rules:
      * Italic info-cell text → Josh (always).
      * Builds sheet unassigned parts on rows 269–329 → Josh.
      * Everything else (other unassigned, assigned-to-unsold, assigned-to-sold)
        → Ben unless italic.
    """
    if _is_italic(info_cell):
        return "Josh"
    if (
        unassigned
        and sheet_name == "Builds"
        and BUILDS_UNASSIGNED_JOSH_ROW_AFTER < row < BUILDS_UNASSIGNED_JOSH_ROW_BEFORE
    ):
        return "Josh"
    return "Ben"


_BAD_SCAM_PREFIX_RE = re.compile(r"^\*([BbSs])\*\s*")


def strip_bad_scam_prefixes(text: str) -> tuple[str, Optional[int], Optional[int]]:
    """Leading *B* → Bad=1, leading *S* → Scam=1. Prefixes are removed from text."""
    bad: Optional[int] = None
    scam: Optional[int] = None
    s = text
    while True:
        m = _BAD_SCAM_PREFIX_RE.match(s)
        if not m:
            break
        if m.group(1).upper() == "B":
            bad = 1
        else:
            scam = 1
        s = s[m.end():]
    return s, bad, scam


# =HYPERLINK("https://...", 81.66)  or  =HYPERLINK("https://...", "label")
_HYPERLINK_FORMULA_RE = re.compile(
    r'^=\s*HYPERLINK\s*\(\s*"([^"]+)"\s*(?:,\s*(.+?))?\s*\)\s*$',
    re.IGNORECASE,
)


def parse_hyperlink_formula(value: object) -> tuple[Optional[str], Optional[object]]:
    """Parse an Excel =HYPERLINK("url", display) formula.

    Returns (url, display) where display is a float when numeric, otherwise the
    stripped string (quotes removed). Native cell.hyperlink links are not handled
    here — callers should still check cell.hyperlink.
    """
    if not isinstance(value, str):
        return None, None
    m = _HYPERLINK_FORMULA_RE.match(value.strip())
    if not m:
        return None, None
    url = (m.group(1) or "").strip() or None
    raw_display = m.group(2)
    if raw_display is None:
        return url, None
    display = raw_display.strip()
    if len(display) >= 2 and display[0] == display[-1] and display[0] in "\"'":
        display = display[1:-1]
    try:
        return url, float(display.replace(",", ""))
    except ValueError:
        return url, display


def _parse_price_value(pv: object) -> Optional[float]:
    if isinstance(pv, (int, float)):
        return float(pv)
    if isinstance(pv, str):
        m = re.search(r"-?\d+(?:\.\d+)?", pv.replace(",", ""))
        if m:
            try:
                return float(m.group(0))
            except ValueError:
                return None
    return None


def parse_part(part_type: str, info_cell: Cell, price_cell: Optional[Cell],
               sale_year: int, sale_month: int) -> Optional[ParsedPart]:
    info_val = info_cell.value
    if info_val is None:
        return None
    info_str = str(info_val).strip()
    if not info_str:
        return None

    # Leading *B* / *S* flags (possibly bad / possibly scam); strip before parse.
    info_str, bad_flag, scam_flag = strip_bad_scam_prefixes(info_str)
    if not info_str:
        return None

    price = None
    order_url = None
    if price_cell is not None:
        pv = price_cell.value
        formula_url, formula_display = parse_hyperlink_formula(pv)
        if formula_url:
            order_url = formula_url
            # Prefer the HYPERLINK friendly value as cost (avoids grabbing digits
            # out of the URL when naively scanning the whole formula string).
            if isinstance(formula_display, (int, float)):
                price = float(formula_display)
            elif isinstance(formula_display, str):
                price = _parse_price_value(formula_display)
        else:
            price = _parse_price_value(pv)
        if not order_url and price_cell.hyperlink is not None:
            order_url = price_cell.hyperlink.target

    m = _PART_RE.match(info_str)
    model = info_str
    seller_raw = None
    date_str = None
    extra = ""
    if m:
        model = (m.group("model") or "").strip()
        seller_raw = (m.group("seller") or "").strip() or None
        date_str = (m.group("date") or "").strip() or None
        extra = (m.group("extra") or "").strip()
        # Trailing notes are conventionally prefixed with '*' to separate them
        # from the date - strip a leading asterisk (and any following whitespace).
        extra = re.sub(r"^\*+\s*", "", extra).strip()
    else:
        # No parenthetical -> whole string is the model / free-text
        model = info_str

    # Colour: "yt" as a whole token in the model text means white.
    color = None
    if model:
        toks = re.split(r"(\s+|[,])", model)
        # strip trailing yt from model tokens (case-insensitive whole word)
        kept: list[str] = []
        for t in toks:
            if t.strip().lower() == "yt":
                color = "white"
                continue
            kept.append(t)
        cleaned = "".join(kept)
        # Also remove any lingering ' yt ' patterns
        cleaned = re.sub(r"\byt\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,")
        model = cleaned or None
    else:
        model = None

    # Pull the manufacturer out of the model text (aliases removed), then
    # expand shorthand tokens like "triz" -> "Trident Z" so meaningful
    # product-line names end up in the model.  If still no manufacturer,
    # try the implied-brand fallback table (product lines that stay in the
    # model but set a manufacturer), and finally - for CPU parts only -
    # a heuristic on the bare model number.
    manufacturer_val: Optional[str] = None
    if model:
        model, manufacturer_val = extract_manufacturer(model)
        if model:
            model = expand_model_shorthand(model)
        if manufacturer_val is None:
            model, manufacturer_val = apply_special_fallback(model)
        if manufacturer_val is None and part_type == "cpu":
            manufacturer_val = infer_cpu_manufacturer(model)
        model = model or None

    seller = canonical_seller(seller_raw)
    # eBay inventory is assumed used; everything else defaults to new.
    condition = "Used" if seller == "eBay" else "New"

    return ParsedPart(
        part_type=part_type,
        manufacturer=manufacturer_val,
        model_number=(model[:100] if model else None),
        seller=seller,
        order_date=parse_part_date(date_str, sale_year, sale_month) if date_str else None,
        color=color,
        cost=price,
        order_url=order_url,
        extra_note=(extra if extra else None),
        raw_info=info_str,
        location=None,  # set by caller via resolve_part_location()
        condition=condition,
        bad=bad_flag,
        scam=scam_flag,
    )


# ---------------------------------------------------------------------------
# SOLD TO / customer parser
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://\S+")
_PHONE_RE = re.compile(r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")

@dataclass
class ParsedCustomer:
    name: Optional[str]
    profile_url: Optional[str]
    conversation_url: Optional[str]
    raw: Optional[str]


def parse_customer(cell_value: object) -> ParsedCustomer:
    if cell_value is None:
        return ParsedCustomer(None, None, None, None)
    raw = str(cell_value).strip()
    if not raw:
        return ParsedCustomer(None, None, None, None)

    urls = _URL_RE.findall(raw)
    conv_url = None
    business_conv_url = None
    prof_url = None
    for u in urls:
        u = u.rstrip(".,;")
        low = u.lower()
        if "facebook.com/messages" in low:
            if not conv_url:
                conv_url = u
        elif "business.facebook.com" in low:
            # Marketplace inbox / business links are conversations, not profiles.
            if not business_conv_url:
                business_conv_url = u
        else:
            if not prof_url:
                prof_url = u
    if not conv_url and business_conv_url:
        conv_url = business_conv_url

    # Strip Unicode bidi / directional-embedding characters that FB messenger
    # tends to wrap phone numbers with, so the phone regex actually matches.
    def _strip_bidi(s: str) -> str:
        return re.sub(r"[\u202a-\u202e\u2066-\u2069]", "", s)

    text = _strip_bidi(_URL_RE.sub("", raw)).strip()
    # First "chunk" (before any $ / newline / long punctuation) is likely the name.
    first_line = text.split("\n", 1)[0]
    first_line = first_line.split("$", 1)[0].strip()
    # Truncate at the first phone number if present (e.g. "Nadine Porter RESGAME (865) 258-4031")
    m = _PHONE_RE.search(first_line)
    if m and m.start() > 0:
        first_line = first_line[: m.start()].strip()
    first_line = re.sub(r"\s{2,}", " ", first_line)
    first_line = first_line.strip(" .,-\u2010\u2013\u2014")
    # If it's implausibly long, truncate at the first period or comma.
    if len(first_line) > 60:
        for sep in [". ", ", "]:
            if sep in first_line:
                first_line = first_line.split(sep, 1)[0]
                break
        first_line = first_line[:60].rstrip()
    name = first_line or None

    return ParsedCustomer(
        name=name,
        profile_url=prof_url,
        conversation_url=conv_url,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Customer-info payment splitting
# ---------------------------------------------------------------------------
#
# The sheet's Paid / Actual Sell cell is always the total paid. When the
# SOLD TO / customer-info cell describes individual payments whose amounts
# sum to that total, emit one Payments row per described payment; otherwise
# emit a single payment for the Paid amount.

@dataclass
class PaymentRecord:
    amount: float
    tax: Optional[float] = None
    fee: Optional[float] = None
    method: Optional[str] = None
    date: Optional[dt.date] = None
    type: str = "payment"  # payment | deposit | refund


_PAYMENT_METHOD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bcash\s*app\b", re.I), "CashApp"),
    (re.compile(r"\bcashapp\b", re.I), "CashApp"),
    (re.compile(r"\bvenmo\b", re.I), "Venmo"),
    (re.compile(r"\bzelle\b", re.I), "Zelle"),
    (re.compile(r"\bpaypal\b", re.I), "PayPal"),
    (re.compile(r"\bapple\s*pay\b", re.I), "other"),
    (re.compile(r"\bchime\b", re.I), "other"),
    (re.compile(r"\bcheck\b", re.I), "check"),
    (re.compile(r"\bcash\b", re.I), "cash"),
]

# Amount anchors: $75 / PAID 70 / deposited 100 / paid remaining 840
_PAY_AMOUNT_RE = re.compile(
    r"(?i)"
    r"(?P<refund>refunded(?:\s+with)?\s+)?"
    r"(?:"
    r"\$\s*"
    r"|(?:paid|deposited|deposit|downpayment|down\s*payment)\s+\$?\s*"
    r"|paid\s+remaining\s+\$?\s*"
    r")"
    r"(?P<amt>[0-9]{1,5}(?:\.[0-9]{1,2})?)"
)

# Fee attached to a payment: "- $2.99 fee", "minus $2.99 fee", "$100-$2.99".
# Require a '$' (or the word "fee") so dates like "12-31" are not treated as fees.
_PAY_FEE_RE = re.compile(
    r"(?i)"
    r"(?:"
    r"(?:\bminus\b|-)\s*\$\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)"
    r"|(?:\bminus\b|-)\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)\s*fee"
    r")"
)

_PAY_DATE_RE = re.compile(r"\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b")


def _payment_method_from_text(text: str) -> Optional[str]:
    for pat, method in _PAYMENT_METHOD_PATTERNS:
        if pat.search(text):
            return method
    return None


def _payment_date_from_text(
    text: str, sale_year: int, sale_month: int
) -> Optional[dt.date]:
    m = _PAY_DATE_RE.search(text)
    if not m:
        return None
    return parse_part_date(m.group(0), sale_year, sale_month)


def _is_fee_amount_match(text: str, start: int) -> bool:
    """True when a $amount is a fee deduction (preceded by '-' / 'minus')."""
    prefix = text[max(0, start - 12):start]
    return bool(re.search(r"(?i)(?:\bminus\b|-)\s*$", prefix.rstrip()))


def _strip_for_payment_parse(raw: str) -> str:
    def _strip_bidi(s: str) -> str:
        return re.sub(r"[\u202a-\u202e\u2066-\u2069]", "", s)

    text = _strip_bidi(raw)
    text = _URL_RE.sub(" ", text)
    text = _PHONE_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_customer_payments(
    customer_info: Optional[str],
    paid_total: float,
    sale_date: Optional[dt.date],
    sheet_year: int,
) -> Optional[list[PaymentRecord]]:
    """Parse payment lines from customer info when they reconcile to paid_total.

    Returns a list of PaymentRecord if (and only if) two or more payments are
    described and their amounts sum to paid_total (gross, or net of noted
    fees). Otherwise returns None — caller should emit a single Paid-cell
    payment.
    """
    if not customer_info or paid_total is None:
        return None
    try:
        paid_total = float(paid_total)
    except (TypeError, ValueError):
        return None
    if paid_total <= 0:
        return None

    text = _strip_for_payment_parse(customer_info)
    sale_year = sale_date.year if sale_date else sheet_year
    sale_month = sale_date.month if sale_date else 12

    def _is_date_misread(m: re.Match[str]) -> bool:
        """Reject 'deposit 3-25' / 'paid 1-2' where the number is a date month."""
        after = text[m.end(): m.end() + 3]
        return bool(re.match(r"[-/]\d", after))

    matches = [
        m for m in _PAY_AMOUNT_RE.finditer(text)
        if (m.group("refund") or not _is_fee_amount_match(text, m.start()))
        and not _is_date_misread(m)
    ]
    if len(matches) < 2:
        return None

    drafts: list[dict] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        segment = text[start:end]
        amount = float(m.group("amt"))
        fee = None
        fee_m = _PAY_FEE_RE.search(segment)
        if fee_m:
            fee_val = float(next(g for g in fee_m.groups() if g is not None))
            # Don't treat the payment amount itself as its fee
            if abs(fee_val - amount) > 0.001:
                fee = fee_val

        is_refund = bool(m.group("refund")) or bool(
            re.search(r"(?i)\brefunded\b", segment[:24])
        )
        is_deposit = bool(
            re.search(r"(?i)\bdeposit|down\s*payment|downpayment", segment)
        )
        if is_refund:
            ptype = "refund"
        elif is_deposit:
            ptype = "deposit"
        else:
            ptype = "payment"

        drafts.append({
            "amount": amount,
            "fee": fee,
            "method": _payment_method_from_text(segment),
            "date": _payment_date_from_text(segment, sale_year, sale_month),
            "type": ptype,
        })

    def _signed_sum(use_net: bool) -> float:
        total = 0.0
        for d in drafts:
            amt = d["amount"]
            if use_net and d["fee"]:
                amt = amt - d["fee"]
            if d["type"] == "refund":
                total -= amt
            else:
                total += amt
        return total

    sum_gross = _signed_sum(False)
    sum_net = _signed_sum(True)
    use_net = False
    if abs(sum_gross - paid_total) < 0.02:
        use_net = False
    elif abs(sum_net - paid_total) < 0.02:
        use_net = True
    else:
        return None

    payments: list[PaymentRecord] = []
    for d in drafts:
        amount = d["amount"]
        fee = d["fee"]
        if use_net and fee:
            amount = round(amount - fee, 2)
        payments.append(PaymentRecord(
            amount=round(amount, 2),
            fee=fee,
            method=d["method"],
            date=d["date"],
            type=d["type"],
        ))
    return payments


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def sql_str(s: Optional[str], max_len: Optional[int] = None) -> str:
    """Emit an nvarchar literal or the word NULL."""
    if s is None:
        return "NULL"
    if not isinstance(s, str):
        s = str(s)
    if max_len is not None and len(s) > max_len:
        # ASCII "..." only — a Unicode ellipsis can expand to multiple chars
        # when sqlcmd reads the file with a legacy code page.
        s = s[: max_len - 3] + "..."
    return "N'" + s.replace("'", "''") + "'"


def sql_num(x) -> str:
    if x is None:
        return "NULL"
    if isinstance(x, bool):
        return "1" if x else "0"
    if isinstance(x, (int, float)):
        if isinstance(x, float) and (x != x):     # NaN guard
            return "NULL"
        return f"{x:.4f}".rstrip("0").rstrip(".") or "0"
    return "NULL"


def sql_bool(x) -> str:
    return "1" if x else "0"


def sql_date(d) -> str:
    if d is None:
        return "NULL"
    if isinstance(d, dt.datetime):
        return f"'{d.strftime('%Y-%m-%d %H:%M:%S')}'"
    if isinstance(d, dt.date):
        return f"'{d.strftime('%Y-%m-%d')}'"
    return "NULL"


def as_number(value) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        m = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
        if m:
            try:
                return float(m.group(0))
            except ValueError:
                return None
    return None


def as_str(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def clean_note(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = re.sub(r"\r\n?", "\n", s).strip()
    return s or None


def is_tax_summary_row(ws: Worksheet, row: int, cfg: dict) -> bool:
    """M-status monthly tax summary rows have no parts and 'TAXES' text
    somewhere in the trailing summary columns."""
    if ws.cell(row=row, column=1).value != "M":
        return False
    # Any part text cell filled?
    for _, cinfo, _cprice in cfg["part_pairs"]:
        v = ws.cell(row=row, column=cinfo).value
        if v not in (None, ""):
            return False
    # Look for the "TAXES:" tag anywhere on the row.
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=row, column=c).value
        if isinstance(v, str) and "TAXES" in v.upper():
            return True
    return False


# ---------------------------------------------------------------------------
# Builder-user derivation
# ---------------------------------------------------------------------------
#
# Each of these User.Id values is inserted via IF-NOT-EXISTS at the top of
# the SQL script so the Computer.BuilderUserId FK is always satisfied.

BUILDER_DEFAULT   = "Ben L"
BUILDER_BRANDEN   = "Branden J"
BUILDER_JOSHUA    = "Joshua L"
BUILDER_DANIEL    = "Daniel L"
BUILDER_BEN_JOSH  = "Ben+Josh"
BUILDER_JOSH_B    = "Josh B"

ALL_BUILDERS = (
    BUILDER_DEFAULT, BUILDER_BRANDEN, BUILDER_JOSHUA,
    BUILDER_DANIEL, BUILDER_BEN_JOSH, BUILDER_JOSH_B,
)


def _admin_password_hash(password: str = "admin") -> str:
    """Produce a PBKDF2-SHA256 hash in the same format that
    Server/Services/PasswordHasher.Hash emits: ``base64(salt).base64(key)``,
    16-byte salt, 32-byte key, 100_000 iterations.

    We seed the 'admin' user inline in the generated SQL so that the FK
    constraints on Computer.AddedUserId are satisfied even against a fresh,
    empty database (the C# DbSeeder only inserts admin when the Users table
    is empty, which is no longer the case after this import runs)."""
    import base64
    import hashlib
    import os
    salt = os.urandom(16)
    key  = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt,
                               100_000, dklen=32)
    return f"{base64.b64encode(salt).decode()}.{base64.b64encode(key).decode()}"


def _misc3_mentions_branden(text: Optional[str]) -> bool:
    t = (text or "").lower()
    return "brandon" in t or "branden" in t


def strip_branden_from_misc3(text: Optional[str]) -> Optional[str]:
    """Remove Branden/Brandon clauses from Misc 3 for Computer.BulkDesc."""
    if not text:
        return None
    chunks = [c.strip() for c in str(text).split(",")]
    kept = [
        c for c in chunks
        if "brandon" not in c.lower() and "branden" not in c.lower()
    ]
    result = ", ".join(kept)
    result = re.sub(r"\bbranden\b|\bbrandon\b", "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s+", " ", result).strip(" ,;$-")
    return result or None


def parse_misc3_combined(text: str) -> tuple[Optional[str], Optional[float]]:
    """Parse 2025-style Misc 3 cells that embed price + description.

    Examples: '$9 winkey', '$20: montech ax120, 3x th-right 120', 'winkey $9'.
    """
    raw = (text or "").strip()
    if not raw:
        return None, None

    # Leading $amount with optional : / - separator
    m = re.match(r"^\$\s*(\d+(?:\.\d+)?)\s*[:\-]?\s*(.*)$", raw)
    if m:
        cost = float(m.group(1))
        desc = (m.group(2) or "").strip(" :,-") or None
        return desc, cost

    # Trailing $amount
    m = re.match(r"^(.*?)\s+\$\s*(\d+(?:\.\d+)?)\s*$", raw)
    if m:
        desc = (m.group(1) or "").strip(" :,-") or None
        return desc, float(m.group(2))

    # Bare leading amount without $
    m = re.match(r"^(\d+(?:\.\d+)?)\s*[:\-]\s*(.+)$", raw)
    if m:
        return m.group(2).strip(" :,-") or None, float(m.group(1))

    return raw, None


def parse_bulk_misc3(
    misc3_text: Optional[str],
    misc3_dollar: Optional[float],
    *,
    combined: bool,
) -> tuple[Optional[str], Optional[float]]:
    """Map Misc 3 → (BulkDesc, BulkCost).

    Branden/Brandon references are stripped from the description. When present,
    BRANDEN_MISC3_WAGE is subtracted from the cost (wage is stored separately).
    """
    if not misc3_text and misc3_dollar is None:
        return None, None

    has_branden = _misc3_mentions_branden(misc3_text)

    if combined:
        desc, cost = parse_misc3_combined(misc3_text or "")
    else:
        desc = misc3_text
        cost = misc3_dollar

    desc = strip_branden_from_misc3(desc) if desc else None
    # If the whole cell was only "brandon", strip may empty a combined desc
    # that still had a price — keep cost handling below.
    if combined and desc is None and misc3_text and not has_branden:
        desc = None

    if has_branden and cost is not None:
        cost = cost - BRANDEN_MISC3_WAGE

    if cost is not None:
        # Float noise / over-subtract → treat as no bulk cost.
        if abs(cost) < 0.005:
            cost = None
        elif cost < 0:
            cost = None

    if desc is None and cost is None:
        return None, None
    return desc, cost


def determine_builder(misc3_val: Optional[str], note_val: Optional[str]) -> Optional[str]:
    """Return the User.Id of the builder for a computer row, or None if
    there is no indicator in Misc 3 / Note.

    Priority (case-insensitive substring match):

      1. Misc 3 column contains 'branden' -> Branden J.
      2. Note column contains 'joshua' or 'joshy' -> Joshua L.
      3. Note column contains 'danny' or 'daniel' -> Daniel L.
      4. Note column contains 'josh_t' -> Ben+Josh.
      5. Note column contains 'josh_s' or 'josh' -> Josh B.
      6. Otherwise -> None (caller may default Sold builds to Ben L).

    Rule 5's 'josh' catch-all is checked last so more specific tokens win.
    """
    m = (misc3_val or "").lower()
    n = (note_val or "").lower()
    if "branden" in m:
        return BUILDER_BRANDEN
    if "joshua" in n or "joshy" in n:
        return BUILDER_JOSHUA
    if "danny" in n or "daniel" in n:
        return BUILDER_DANIEL
    if "josh_t" in n:
        return BUILDER_BEN_JOSH
    if "josh_s" in n or "josh" in n:
        return BUILDER_JOSH_B
    return None


# ---------------------------------------------------------------------------
# Build extraction
# ---------------------------------------------------------------------------

@dataclass
class ComputerRecord:
    sheet: str
    row: int
    name: str
    type: str              # "PC" or "Parts"
    status: str
    added_date: dt.date
    sold_date: Optional[dt.date]
    location: Optional[str]
    price: Optional[float]
    tax: Optional[float]
    original_price: Optional[float]
    customer_name: Optional[str]
    customer_url: Optional[str]
    conversation_url: Optional[str]
    customer_info: Optional[str]
    notes: Optional[str]
    bulk_desc: Optional[str] = None
    bulk_cost: Optional[float] = None
    parts: list[ParsedPart] = field(default_factory=list)
    placeholders: list[PlaceholderRecord] = field(default_factory=list)
    payments: list[PaymentRecord] = field(default_factory=list)
    fee: Optional[float] = None  # sheet Fee column (attached to largest payment)
    builder_user_id: Optional[str] = None
    wages: list["WageRecord"] = field(default_factory=list)


@dataclass
class WageRecord:
    builder_user_id: str
    amount: float
    paid_date: Optional[dt.date]
    paid_method: Optional[str]
    notes: Optional[str]
    sheet: str
    row: int


_PAID_METHOD_MAP = {
    "zelle": "Zelle",
    "venmo": "Venmo",
    "paypal": "PayPal",
    "pp": "PayPal",
    "cash": "cash",
    "cashapp": "Cash App",
    "cash app": "Cash App",
    "check": "check",
    "other": "other",
}


def canonical_paid_method(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.strip().lower()
    return _PAID_METHOD_MAP.get(key, raw.strip())


def _cell(ws: Worksheet, row: int, col: Optional[int]) -> Optional[Cell]:
    if col is None:
        return None
    return ws.cell(row=row, column=col)


def _as_date(value) -> Optional[dt.date]:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    return None


def _compose_pc_name(parts: list[ParsedPart],
                     placeholders: list[PlaceholderRecord],
                     sheet: str, row: int) -> str:
    """Build Computer.Name as:

        {case manufacturer} {case model} - {gpu model} ({row})

    White cases append `` (white)`` after the case model number.  Missing
    case / gpu render as ``?``.  Placeholder descriptions are used when the
    case/gpu cell was a TBD planned slot.  Truncated to 200 chars.
    """
    case = next((p for p in parts if p.part_type == "case"), None)
    if case is not None:
        mfr = (case.manufacturer or "").strip()
        model = (case.model_number or "").strip()
        if model and case.color and case.color.strip().lower() == "white":
            model = f"{model} (white)"
        case_part = " ".join(x for x in (mfr, model) if x) or "?"
        if case_part != "?" and not model and case.color and case.color.strip().lower() == "white":
            # Manufacturer only, but still mark white.
            case_part = f"{case_part} (white)"
    else:
        case_part = next(
            (ph.description for ph in placeholders if ph.part_type == "case"), None
        ) or "?"

    gpu = next((p for p in parts if p.part_type == "gpu"), None)
    if gpu is not None:
        gpu_part = (gpu.model_number or "").strip() or "?"
    else:
        gpu_part = next(
            (ph.description for ph in placeholders if ph.part_type == "gpu"), None
        ) or "?"

    name = f"{case_part} - {gpu_part} ({row})"
    if len(name) > 200:
        name = name[:199] + "\u2026"
    return name


def extract_builds_sheet(ws: Worksheet, cfg: dict) -> tuple[list[ComputerRecord], list[ParsedPart]]:
    """Extract (computer_rows, unassigned_parts) from a Builds-style sheet.

    - Rows with a status letter in col 1 become Computer records (as before).
    - Rows with no status letter but with parts:
        * if cfg['import_unassigned'] is True, their parts are returned in
          the second list with ComputerId left NULL;
        * otherwise the row is silently skipped.
    - When cfg['import_wages'] is True (Builds sheet only), each computer
      may carry WageRecords (emitted with that computer's Id):
        * Josh B wages from columns AI–AL (note / amount / date / method)
        * Branden J wages ($90 Cash App) when Misc 3 contains brandon/branden
    """
    computers: list[ComputerRecord] = []
    unassigned: list[ParsedPart] = []
    year = cfg["year"]
    import_unassigned = bool(cfg.get("import_unassigned"))
    import_wages = bool(cfg.get("import_wages"))

    for row in range(2, ws.max_row + 1):
        if is_tax_summary_row(ws, row, cfg):
            continue

        # Anything to import here?
        has_any_part = False
        for _pt, cinfo, _cprice in cfg["part_pairs"]:
            if ws.cell(row=row, column=cinfo).value not in (None, ""):
                has_any_part = True
                break
        if not has_any_part:
            continue

        status_letter = ws.cell(row=row, column=cfg["col_status"]).value
        if isinstance(status_letter, str):
            status_letter = status_letter.strip()
        if not status_letter:
            # No status letter -> not a computer row.
            if not import_unassigned:
                continue
            # Parse the parts and put them in the unassigned bucket with
            # date-guessing anchored at "today" within the sheet's year.
            today = dt.date.today()
            sale_year = year
            sale_month = today.month if today.year == year else 12
            for pt, cinfo, cprice in cfg["part_pairs"]:
                info_cell = ws.cell(row=row, column=cinfo)
                info_val = info_cell.value
                if info_val in (None, ""):
                    continue
                # TBD cells are planned placeholders and require a computer —
                # skip them on unassigned (no-status) rows.
                if is_tbd_part_text(str(info_val)):
                    continue
                p = parse_part(
                    pt,
                    info_cell,
                    ws.cell(row=row, column=cprice) if cprice else None,
                    sale_year,
                    sale_month,
                )
                if p is not None:
                    # Unassigned Misc / Misc 2 cells are RAM inventory, not misc.
                    if p.part_type == "misc":
                        p.part_type = "ram"
                    p.location = resolve_part_location(
                        info_cell,
                        sheet_name=ws.title,
                        row=row,
                        unassigned=True,
                    )
                    unassigned.append(p)
            continue

        status = STATUS_MAP.get(status_letter, "Planned")

        note = as_str(ws.cell(row=row, column=cfg["col_note"]).value)
        misc3 = as_str(_cell(ws, row, cfg.get("col_misc3")).value
                       if cfg.get("col_misc3") else None)
        misc3_dollar = as_number(
            _cell(ws, row, cfg.get("col_misc3_dollar")).value
            if cfg.get("col_misc3_dollar") else None
        )
        bulk_desc, bulk_cost = parse_bulk_misc3(
            misc3,
            misc3_dollar,
            combined=bool(cfg.get("misc3_combined")),
        )

        sale_dt = _cell(ws, row, cfg.get("col_sale_date"))
        sale_val = sale_dt.value if sale_dt else None
        if isinstance(sale_val, dt.datetime):
            sold_date = sale_val.date()
        elif isinstance(sale_val, dt.date):
            sold_date = sale_val
        else:
            sold_date = None
        # 2030-10-10 etc. are 'not sold yet' placeholders in the sheet.
        if sold_date and sold_date > dt.date.today() + dt.timedelta(days=365):
            sold_date = None

        if sold_date:
            sale_year, sale_month = sold_date.year, sold_date.month
        else:
            today = dt.date.today()
            sale_year = year
            sale_month = today.month if today.year == year else 12

        actual_sell = as_number(_cell(ws, row, cfg.get("col_actual_sell")).value if cfg.get("col_actual_sell") else None)
        expected_sell = as_number(_cell(ws, row, cfg.get("col_expected_sell")).value if cfg.get("col_expected_sell") else None)
        tax = as_number(_cell(ws, row, cfg.get("col_tax")).value if cfg.get("col_tax") else None)
        if tax is not None and tax < 0:
            tax = -tax
        fee = as_number(_cell(ws, row, cfg.get("col_fee")).value if cfg.get("col_fee") else None)
        # Spreadsheet fees are usually negative (cost); store as a positive amount.
        if fee is not None and fee < 0:
            fee = -fee

        payment_method = as_str(_cell(ws, row, cfg.get("col_payment_method")).value
                                if cfg.get("col_payment_method") else None)

        sold_to_cell = _cell(ws, row, cfg.get("col_sold_to"))
        sold_to_val = sold_to_cell.value if sold_to_cell else None
        cust = parse_customer(sold_to_val)

        # Prefer FB hyperlink target if openpyxl found one on the cell.
        if sold_to_cell is not None and sold_to_cell.hyperlink is not None:
            link_target = sold_to_cell.hyperlink.target
            if link_target:
                low = link_target.lower()
                is_messages = "facebook.com/messages" in low
                is_business = "business.facebook.com" in low
                if is_messages or is_business:
                    if not cust.conversation_url:
                        cust = ParsedCustomer(
                            cust.name, cust.profile_url, link_target, cust.raw
                        )
                elif not cust.profile_url:
                    cust = ParsedCustomer(
                        cust.name, link_target, cust.conversation_url, cust.raw
                    )

        josh_split = as_str(_cell(ws, row, cfg.get("col_josh_split")).value
                            if cfg.get("col_josh_split") else None)

        # Extract parts. Cells containing "tbd" become PartPlaceholder rows
        # (custom text = sheet name with "tbd" removed), not inventory Parts.
        parts: list[ParsedPart] = []
        placeholders: list[PlaceholderRecord] = []
        for pt, cinfo, cprice in cfg["part_pairs"]:
            info_cell = ws.cell(row=row, column=cinfo)
            info_val = info_cell.value
            if info_val in (None, ""):
                continue
            info_str = str(info_val).strip()
            if not info_str:
                continue
            if is_tbd_part_text(info_str):
                placeholders.append(PlaceholderRecord(
                    part_type=pt,
                    description=placeholder_description_from_sheet(info_str),
                ))
                continue
            p = parse_part(
                pt,
                info_cell,
                ws.cell(row=row, column=cprice) if cprice else None,
                sale_year,
                sale_month,
            )
            if p is not None:
                # Assigned parts: Ben unless italic → Josh (sold or unsold).
                p.location = resolve_part_location(
                    info_cell,
                    sheet_name=ws.title,
                    row=row,
                    unassigned=False,
                )
                parts.append(p)

        # Builder is derived from the Misc 3 / Note columns. Unsold builds
        # with no indicator stay null; Sold builds still default to Ben L.
        builder = determine_builder(misc3, note)
        if builder is None and status == "Sold":
            builder = BUILDER_DEFAULT

        # Parts in a Sold PC are considered tested at sale time.
        if status == "Sold":
            tested_when = sold_date or dt.date(year, 1, 1)
            for p in parts:
                p.tested_date = tested_when
                p.tested_user_id = builder

        # Compose computer-level notes.  Per-part trailing text is stored on
        # Part.Notes below, not folded in here.  Josh-split formulas on the
        # Builds sheet become Wage.Notes instead of Computer.Notes.
        note_bits: list[str] = [IMPORT_TAG, f"{ws.title} row {row}"]
        if note:
            note_bits.append(f"Sheet note: {note}")
        if josh_split and not import_wages:
            note_bits.append(f"Josh split: {josh_split}")
        if cust.name:
            note_bits.append(f"Customer: {cust.name}")
        notes = clean_note("\n".join(note_bits))

        # "{case mfr} {case model}[(white)] - {gpu model} ({row})"
        name = _compose_pc_name(parts, placeholders, ws.title, row)

        row_wages: list[WageRecord] = []
        if import_wages:
            # Josh B payouts from columns AI–AL
            wage_amount = as_number(
                _cell(ws, row, cfg.get("col_wage_amount")).value
                if cfg.get("col_wage_amount") else None
            )
            if wage_amount is not None and wage_amount != 0:
                wage_note = as_str(
                    _cell(ws, row, cfg.get("col_wage_note")).value
                    if cfg.get("col_wage_note") else None
                )
                wage_date = _as_date(
                    _cell(ws, row, cfg.get("col_wage_date")).value
                    if cfg.get("col_wage_date") else None
                )
                wage_method = canonical_paid_method(as_str(
                    _cell(ws, row, cfg.get("col_wage_method")).value
                    if cfg.get("col_wage_method") else None
                ))
                tagged = f"{IMPORT_TAG} {wage_note}".strip() if wage_note else IMPORT_TAG
                row_wages.append(WageRecord(
                    builder_user_id=BUILDER_JOSH_B,
                    amount=abs(wage_amount),
                    paid_date=wage_date,
                    paid_method=wage_method,
                    notes=tagged,
                    sheet=ws.title,
                    row=row,
                ))

            # Branden J: Misc 3 contains brandon/branden -> $90 Cash App,
            # notes = computer name, paid date = sale date − 3 days.
            if misc3 and ("brandon" in misc3.lower() or "branden" in misc3.lower()):
                branden_date = (
                    sold_date - dt.timedelta(days=3) if sold_date else None
                )
                row_wages.append(WageRecord(
                    builder_user_id=BUILDER_BRANDEN,
                    amount=90.0,
                    paid_date=branden_date,
                    paid_method="Cash App",
                    notes=f"{IMPORT_TAG} {name}",
                    sheet=ws.title,
                    row=row,
                ))

        rec = ComputerRecord(
            sheet=ws.title,
            row=row,
            name=name,
            type="PC",
            status=status,
            added_date=(sold_date or dt.date(year, 1, 1)),
            sold_date=sold_date if status == "Sold" else None,
            location=None,
            # Price is tax-inclusive (sheet Expected/Actual Sell). Use Actual
            # Sell once sold so Price matches Payment.Amount; otherwise Expected.
            price=(actual_sell if status == "Sold" and actual_sell else expected_sell),
            tax=tax if status == "Sold" else None,
            original_price=expected_sell if status == "Sold" and actual_sell and expected_sell != actual_sell else None,
            customer_name=cust.name,
            customer_url=cust.profile_url,
            conversation_url=cust.conversation_url,
            customer_info=cust.raw,
            notes=notes,
            bulk_desc=bulk_desc,
            bulk_cost=bulk_cost,
            parts=parts,
            placeholders=placeholders,
            fee=fee,
            builder_user_id=builder,
            wages=row_wages,
        )
        if status == "Sold" and actual_sell:
            # Paid / Actual Sell is the source of truth for the total. When
            # customer info describes payments that reconcile to that total,
            # emit those rows; otherwise one payment for the Paid amount.
            split = parse_customer_payments(
                cust.raw, actual_sell, sold_date, year
            )
            if split:
                # Tax + sheet Fee go on the largest non-refund payment.
                anchor = max(
                    (p for p in split if p.type != "refund"),
                    key=lambda p: p.amount,
                    default=split[0],
                )
                anchor.tax = tax
                if fee is not None and not any(p.fee for p in split):
                    anchor.fee = fee
                # Default missing dates to sold date.
                for p in split:
                    if p.date is None:
                        p.date = sold_date
                rec.payments = split
            else:
                rec.payments = [PaymentRecord(
                    amount=actual_sell,
                    tax=tax,
                    fee=fee,
                    method=payment_method,
                    date=sold_date,
                    type="payment",
                )]

        computers.append(rec)

    return computers, unassigned


def extract_bulk_sheet(ws: Worksheet, cfg: dict) -> list[ParsedPart]:
    """Return every parsed part from a Bulk sheet as unassigned parts
    (Part.ComputerId will be NULL when emitted). TBD cells are skipped —
    placeholders require a computer."""
    year = cfg["year"]
    parts: list[ParsedPart] = []
    for row in range(2, ws.max_row + 1):
        for pt, cinfo, cprice in cfg["part_pairs"]:
            info_cell = ws.cell(row=row, column=cinfo)
            info_val = info_cell.value
            if info_val in (None, ""):
                continue
            if is_tbd_part_text(str(info_val)):
                continue
            p = parse_part(
                pt,
                info_cell,
                ws.cell(row=row, column=cprice) if cprice else None,
                sale_year=year,
                sale_month=12,        # bulk parts: use year-end so any month is same-year
            )
            if p is not None:
                # Bulk / unassigned Misc / Misc 2 cells are RAM inventory, not misc.
                if p.part_type == "misc":
                    p.part_type = "ram"
                p.location = resolve_part_location(
                    info_cell,
                    sheet_name=ws.title,
                    row=row,
                    unassigned=True,
                )
                parts.append(p)
    return parts


# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------

def _emit_part(W, p: ParsedPart, received: bool, computer_id_sql: str) -> None:
    """Emit a single INSERT INTO Parts statement."""
    W("INSERT INTO Parts")
    W("    (Type, Manufacturer, ModelNumber, Cost, OrderDate, OrderUrl, Seller,")
    W("     Color, HasRgb, CpuSocket, PcieGen, RamType, Location, Received,")
    W("     TestedDate, TestedUserId, Condition, ReturnByDate, Notes, Bad, Scam, ComputerId)")
    W(f"VALUES ({sql_str(p.part_type, 50)}, {sql_str(p.manufacturer, 100)}, "
      f"{sql_str(p.model_number, 100)}, {sql_num(p.cost)}, {sql_date(p.order_date)}, "
      f"{sql_str(p.order_url, 500)}, {sql_str(p.seller, 100)}, "
      f"{sql_str(p.color, 50)}, 0, NULL, NULL, NULL, "
      f"{sql_str(p.location, 100)}, "
      f"{sql_bool(received)}, "
      f"{sql_date(p.tested_date)}, {sql_str(p.tested_user_id, 50)}, "
      f"{sql_str(p.condition, 50)}, NULL, {sql_str(p.extra_note, 2000)}, "
      f"{sql_num(p.bad)}, {sql_num(p.scam)}, {computer_id_sql});")


def _emit_placeholder(W, ph: PlaceholderRecord, computer_id_sql: str) -> None:
    """Emit a single INSERT INTO PartPlaceholders statement."""
    W("INSERT INTO PartPlaceholders (ComputerId, Type, Description)")
    W(f"VALUES ({computer_id_sql}, {sql_str(ph.part_type, 50)}, "
      f"{sql_str(ph.description, 200)});")


def emit_sql(computers: list[ComputerRecord],
             unassigned_parts: list[ParsedPart],
             sellers: set[str]) -> str:
    out: list[str] = []
    W = out.append
    wage_count = sum(len(c.wages) for c in computers)
    placeholder_count = sum(len(c.placeholders) for c in computers)

    W("/* ---------------------------------------------------------------------")
    W(" *  BenBotInventory - bulk import generated by import_builds.py")
    W(" * ---------------------------------------------------------------------")
    W(" *  This script inserts every build row from the target sheets of")
    W(f" *  Builds.xlsx.  Every inserted Computers / unassigned Parts / Wages")
    W(f" *  row is tagged with '{IMPORT_TAG}' in its Notes column so the")
    W(" *  whole batch can be reverted with:")
    W(" *")
    W(f" *      DELETE FROM Parts    WHERE Notes LIKE '%{IMPORT_TAG}%'")
    W(f" *          OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(" *      DELETE FROM Payments WHERE ComputerId IN (SELECT Id FROM Computers")
    W(f" *          WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(f" *      DELETE FROM Wages     WHERE Notes LIKE '%{IMPORT_TAG}%'")
    W(f" *          OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(" *      DELETE FROM PartPlaceholders WHERE ComputerId IN (SELECT Id FROM Computers")
    W(f" *          WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(f" *      DELETE FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%';")
    W(" * ---------------------------------------------------------------------*/")
    W("")
    W("-- Schema upgrades must run in their own batch (GO) so INSERT statements")
    W("-- that reference new columns compile successfully.")
    W("SET NOCOUNT ON;")
    W("")

    W("-- Ensure the Wages table exists (for DBs that predate this schema).")
    W("IF OBJECT_ID(N'dbo.Wages', N'U') IS NULL")
    W("BEGIN")
    W("    CREATE TABLE dbo.Wages (")
    W("        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_Wages PRIMARY KEY,")
    W("        BuilderUserId nvarchar(50) NOT NULL,")
    W("        ComputerId int NULL,")
    W("        Amount decimal(10,2) NOT NULL,")
    W("        PaidDate datetime2 NULL,")
    W("        PaidMethod nvarchar(50) NULL,")
    W("        Notes nvarchar(2000) NULL,")
    W("        CONSTRAINT FK_Wages_Users_BuilderUserId FOREIGN KEY (BuilderUserId)")
    W("            REFERENCES dbo.Users (Id) ON DELETE NO ACTION,")
    W("        CONSTRAINT FK_Wages_Computers_ComputerId FOREIGN KEY (ComputerId)")
    W("            REFERENCES dbo.Computers (Id) ON DELETE SET NULL")
    W("    );")
    W("    CREATE INDEX IX_Wages_BuilderUserId ON dbo.Wages (BuilderUserId);")
    W("    CREATE INDEX IX_Wages_ComputerId ON dbo.Wages (ComputerId);")
    W("END")
    W("ELSE IF COL_LENGTH('Wages', 'ComputerId') IS NULL")
    W("BEGIN")
    W("    ALTER TABLE dbo.Wages ADD ComputerId int NULL;")
    W("    ALTER TABLE dbo.Wages ADD CONSTRAINT FK_Wages_Computers_ComputerId")
    W("        FOREIGN KEY (ComputerId) REFERENCES dbo.Computers (Id) ON DELETE SET NULL;")
    W("    CREATE INDEX IX_Wages_ComputerId ON dbo.Wages (ComputerId);")
    W("END")
    W("")

    W("-- BulkDesc / BulkCost (Misc 3) on Computers.")
    W("IF COL_LENGTH('Computers', 'BulkDesc') IS NULL "
      "ALTER TABLE Computers ADD BulkDesc nvarchar(500) NULL;")
    W("IF COL_LENGTH('Computers', 'BulkCost') IS NULL "
      "ALTER TABLE Computers ADD BulkCost decimal(10,2) NULL;")
    W("")
    W("-- Bad / Scam / Lost flags on Parts (1 = possible, 2 = confirmed).")
    W("IF COL_LENGTH('Parts', 'Bad') IS NULL ALTER TABLE Parts ADD Bad int NULL;")
    W("IF COL_LENGTH('Parts', 'Scam') IS NULL ALTER TABLE Parts ADD Scam int NULL;")
    W("IF COL_LENGTH('Parts', 'Lost') IS NULL ALTER TABLE Parts ADD Lost int NULL;")
    W("")

    W("-- Ensure PartPlaceholders exists (planned TBD slots from the sheet).")
    W("IF OBJECT_ID(N'dbo.PartPlaceholders', N'U') IS NULL")
    W("BEGIN")
    W("    CREATE TABLE dbo.PartPlaceholders (")
    W("        Id int NOT NULL IDENTITY(1,1) CONSTRAINT PK_PartPlaceholders PRIMARY KEY,")
    W("        ComputerId int NOT NULL,")
    W("        Type nvarchar(50) NOT NULL,")
    W("        Description nvarchar(200) NOT NULL,")
    W("        CONSTRAINT FK_PartPlaceholders_Computers_ComputerId FOREIGN KEY (ComputerId)")
    W("            REFERENCES dbo.Computers (Id) ON DELETE CASCADE,")
    W("        CONSTRAINT FK_PartPlaceholders_PartTypes_Type FOREIGN KEY (Type)")
    W("            REFERENCES dbo.PartTypes (Type) ON DELETE NO ACTION")
    W("    );")
    W("    CREATE INDEX IX_PartPlaceholders_ComputerId ON dbo.PartPlaceholders (ComputerId);")
    W("    CREATE INDEX IX_PartPlaceholders_Type ON dbo.PartPlaceholders (Type);")
    W("END")
    W("")
    W("GO")
    W("")

    W("SET NOCOUNT ON;")
    W("SET XACT_ABORT ON;")
    W("BEGIN TRAN;")
    W("")
    W("DECLARE @cid INT;")   # declared once, reused for every computer
    W("")

    W("-- Remove any previous import tagged with this Notes marker.")
    W(f"DELETE FROM Parts    WHERE Notes LIKE '%{IMPORT_TAG}%'")
    W(f"    OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W("DELETE FROM Payments WHERE ComputerId IN (SELECT Id FROM Computers")
    W(f"    WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(f"DELETE FROM Wages     WHERE Notes LIKE '%{IMPORT_TAG}%'")
    W(f"    OR ComputerId IN (SELECT Id FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W("IF OBJECT_ID(N'dbo.BuildNotes', N'U') IS NOT NULL")
    W("    DELETE FROM BuildNotes WHERE ComputerId IN (SELECT Id FROM Computers")
    W(f"        WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W("IF OBJECT_ID(N'dbo.PartPlaceholders', N'U') IS NOT NULL")
    W("    DELETE FROM PartPlaceholders WHERE ComputerId IN (SELECT Id FROM Computers")
    W(f"        WHERE Notes LIKE '%{IMPORT_TAG}%');")
    W(f"DELETE FROM Computers WHERE Notes LIKE '%{IMPORT_TAG}%';")
    W("")

    W("-- Ensure Ben/Josh Location rows exist (Part.Location FK -> Locations).")
    for loc in ("Ben", "Josh"):
        W(f"IF NOT EXISTS (SELECT 1 FROM Locations WHERE Name = {sql_str(loc)}) "
          f"INSERT INTO Locations (Name) VALUES ({sql_str(loc)});")
    W("")

    # Case-sensitive collations are required here: the default CI collation
    # treats N'new' and N'New' as equal, so a DELETE of the legacy lowercase
    # rows would also wipe the Proper-cased lookup values we just ensured.
    W("-- Ensure Proper-cased Conditions exist (Part.Condition FK -> Conditions).")
    W("-- Case-sensitive checks so legacy lowercase rows are not confused with New/Used/As-is.")
    for cond in ("New", "Used", "As-is"):
        W(f"IF NOT EXISTS (SELECT 1 FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS = {sql_str(cond)}) "
          f"INSERT INTO Conditions (Name) VALUES ({sql_str(cond)});")
    W("UPDATE Parts SET Condition = N'New'   WHERE Condition COLLATE Latin1_General_CS_AS = N'new';")
    W("UPDATE Parts SET Condition = N'Used'  WHERE Condition COLLATE Latin1_General_CS_AS = N'used';")
    W("UPDATE Parts SET Condition = N'As-is' WHERE Condition COLLATE Latin1_General_CS_AS = N'as-is';")
    W("DELETE FROM Conditions WHERE Name COLLATE Latin1_General_CS_AS IN (N'new', N'used', N'as-is');")
    W("")

    W("-- Ensure the 'admin' user exists (Computer.AddedUserId FK -> Users).")
    W("-- Password is 'admin' (change it after first login).  The hash is a")
    W("-- valid PBKDF2-SHA256 payload in the format PasswordHasher.Hash emits.")
    W("-- PermissionLevel must be set explicitly (fresh DBs may have no DEFAULT).")
    admin_hash = _admin_password_hash("admin")
    W(f"IF NOT EXISTS (SELECT 1 FROM Users WHERE Id = N'admin') "
      f"INSERT INTO Users (Id, Name, PasswordHash, PermissionLevel) "
      f"VALUES (N'admin', N'Administrator', {sql_str(admin_hash)}, 3);")
    W("")

    W("-- Ensure the builder / tested-by Users exist (Computer.BuilderUserId,")
    W("-- Part.TestedUserId FK -> Users).  These are placeholder accounts that")
    W("-- cannot log in (empty password hash); rename or delete later as needed.")
    for u in ALL_BUILDERS:
        W(f"IF NOT EXISTS (SELECT 1 FROM Users WHERE Id = {sql_str(u)}) "
          f"INSERT INTO Users (Id, Name, PasswordHash, PermissionLevel) "
          f"VALUES ({sql_str(u)}, {sql_str(u)}, N'', 2);")
    W("")

    W("-- Ensure all referenced sellers exist in the Sellers lookup table.")
    for s in sorted(sellers):
        W(f"IF NOT EXISTS (SELECT 1 FROM Sellers WHERE Name = {sql_str(s)}) "
          f"INSERT INTO Sellers (Name) VALUES ({sql_str(s)});")
    W("")

    for i, c in enumerate(computers, start=1):
        W(f"-- =========================================================================")
        W(f"-- {i}. {c.sheet} row {c.row}: {c.name}")
        W(f"-- =========================================================================")
        W("INSERT INTO Computers")
        W("    (Name, Description, Type, Status, AddedDate, AddedUserId, BuilderUserId,")
        W("     Location, IgnoreIncomplete, Price, Tax, OriginalPrice, BulkDesc, BulkCost, SoldDate,")
        W("     CustomerName, CustomerUrl, ConversationUrl, CustomerInfo,")
        W("     CustomerAddress1, CustomerAddress2, CustomerCity, CustomerState, CustomerZip,")
        W("     TrackingNumber, TrackingStatus, Notes, ExpectedCompletionDate)")
        W("VALUES (")
        W(f"    {sql_str(c.name, 200)},")
        W(f"    NULL,")
        W(f"    {sql_str(c.type, 20)},")
        W(f"    {sql_str(c.status, 30)},")
        W(f"    {sql_date(c.added_date)},")
        W(f"    N'admin',")
        W(f"    {sql_str(c.builder_user_id, 50)},")
        W(f"    {sql_str(c.location, 100)},")
        W(f"    0,")   # IgnoreIncomplete - never set by the importer
        W(f"    {sql_num(c.price)},")
        W(f"    {sql_num(c.tax)},")
        W(f"    {sql_num(c.original_price)},")
        W(f"    {sql_str(c.bulk_desc, 500)},")
        W(f"    {sql_num(c.bulk_cost)},")
        W(f"    {sql_date(c.sold_date)},")
        W(f"    {sql_str(c.customer_name, 200)},")
        W(f"    {sql_str(c.customer_url, 500)},")
        W(f"    {sql_str(c.conversation_url, 500)},")
        W(f"    {sql_str(c.customer_info, 2000)},")
        W(f"    NULL, NULL, NULL, NULL, NULL,")
        W(f"    NULL, NULL,")
        W(f"    {sql_str(c.notes, 4000)},")
        W(f"    NULL")
        W(");")
        W("SET @cid = SCOPE_IDENTITY();")

        received = c.status in ("Built", "Active", "Sold", "Traded", "Personal")
        for p in c.parts:
            _emit_part(W, p, received, "@cid")
        for ph in c.placeholders:
            _emit_placeholder(W, ph, "@cid")

        if c.payments and c.status == "Sold":
            # Payment.Date is NOT NULL. Missing dates fall back to sold date,
            # then AddedDate. Sheet Fee / Tax live on the largest payment
            # (set during extract); customer-info splits may carry per-row fees.
            for pay in c.payments:
                pay_date = pay.date or c.sold_date or c.added_date
                W("INSERT INTO Payments (ComputerId, Amount, Tax, Fee, Method, Date, PaymentUrl, Type)")
                W(f"VALUES (@cid, {sql_num(pay.amount)}, {sql_num(pay.tax)}, "
                  f"{sql_num(pay.fee)}, {sql_str(pay.method, 50)}, "
                  f"{sql_date(pay_date)}, NULL, {sql_str(pay.type, 20)});")

        for w in c.wages:
            W("INSERT INTO Wages (BuilderUserId, ComputerId, Amount, PaidDate, PaidMethod, Notes)")
            W(f"VALUES ({sql_str(w.builder_user_id, 50)}, @cid, {sql_num(w.amount)}, "
              f"{sql_date(w.paid_date)}, {sql_str(w.paid_method, 50)}, "
              f"{sql_str(w.notes, 2000)});")
        W("")

    # Unassigned parts: emit with ComputerId = NULL.  Notes get the import
    # tag so the whole batch can still be reverted by tag alone.
    if unassigned_parts:
        W(f"-- =========================================================================")
        W(f"-- Unassigned parts ({len(unassigned_parts)} rows, ComputerId = NULL)")
        W(f"-- =========================================================================")
        for p in unassigned_parts:
            note = p.extra_note or ""
            tag_note = f"{IMPORT_TAG} {note}".strip() if note else IMPORT_TAG
            emit_p = ParsedPart(**{**p.__dict__, "extra_note": tag_note})
            _emit_part(W, emit_p, received=False, computer_id_sql="NULL")
        W("")

    W("COMMIT;")
    W(f"PRINT 'Imported {len(computers)} computers, "
      f"{sum(len(c.parts) for c in computers)} parts, "
      f"{placeholder_count} placeholders, "
      f"{len(unassigned_parts)} unassigned parts, and "
      f"{wage_count} wages.';")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(workbook_path: Optional[str] = None) -> None:
    path = os.path.abspath(workbook_path) if workbook_path else WORKBOOK_PATH
    print(f"Loading {path!r}")
    wb = openpyxl.load_workbook(path, data_only=True)

    all_computers: list[ComputerRecord] = []
    all_unassigned: list[ParsedPart] = []
    all_sellers: set[str] = set()

    for sheet_name in SHEET_ORDER:
        cfg = SHEET_CONFIG[sheet_name]
        ws = wb[sheet_name]
        print(f"  processing {sheet_name!r} ({ws.max_row} rows)...")
        if cfg["kind"] == "builds":
            recs, unassigned = extract_builds_sheet(ws, cfg)
            n_wages = sum(len(r.wages) for r in recs)
            print(f"    -> {len(recs)} computers, "
                  f"{sum(len(r.parts) for r in recs)} parts, "
                  f"{sum(len(r.placeholders) for r in recs)} placeholders, "
                  f"{len(unassigned)} unassigned parts, "
                  f"{n_wages} wages")
            all_computers.extend(recs)
            all_unassigned.extend(unassigned)
        else:
            parts = extract_bulk_sheet(ws, cfg)
            print(f"    -> {len(parts)} unassigned parts")
            all_unassigned.extend(parts)

    for c in all_computers:
        for p in c.parts:
            if p.seller:
                all_sellers.add(p.seller)
    for p in all_unassigned:
        if p.seller:
            all_sellers.add(p.seller)

    sql = emit_sql(all_computers, all_unassigned, all_sellers)
    with open(OUTPUT_SQL_PATH, "w", encoding="utf-8") as f:
        f.write(sql)

    total_parts = sum(len(c.parts) for c in all_computers)
    total_placeholders = sum(len(c.placeholders) for c in all_computers)
    total_payments = sum(len(c.payments) for c in all_computers)
    total_wages = sum(len(c.wages) for c in all_computers)
    print()
    print(f"Wrote {OUTPUT_SQL_PATH}")
    print(f"  Computers:         {len(all_computers)}")
    print(f"  Parts (assigned):  {total_parts}")
    print(f"  Placeholders:      {total_placeholders}")
    print(f"  Parts (unassigned):{len(all_unassigned)}")
    print(f"  Payments:          {total_payments}")
    print(f"  Wages:             {total_wages}")
    print(f"  Sellers to seed:   {len(all_sellers)}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
