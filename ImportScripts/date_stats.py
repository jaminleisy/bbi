"""Summarize the year distribution of OrderDate and SoldDate in the SQL."""
import re
from collections import Counter

PATH = r"C:\BenBotInventory\ImportScripts\builds_import.sql"

with open(PATH, "r", encoding="utf-8") as f:
    text = f.read()

# Extract all YYYY-MM-DD dates
dates = re.findall(r"'(\d{4})-\d{2}-\d{2}'", text)
c = Counter(dates)
print("Year distribution across ALL date literals in the SQL:")
for year in sorted(c):
    print(f"  {year}: {c[year]:,}")
