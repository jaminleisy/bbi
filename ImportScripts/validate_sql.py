"""Static syntactic checks on the generated SQL file."""
import re

PATH = r"C:\BenBotInventory\ImportScripts\builds_import.sql"

with open(PATH, "r", encoding="utf-8") as f:
    text = f.read()

print(f"Bytes: {len(text):,}  Lines: {text.count(chr(10)):,}")

def count(sub):
    return text.count(sub)

print(f"INSERT INTO Computers: {count('INSERT INTO Computers')}")
print(f"INSERT INTO Parts:     {count('INSERT INTO Parts')}")
print(f"INSERT INTO Payments:  {count('INSERT INTO Payments')}")
print(f"INSERT INTO Sellers:   {count('INSERT INTO Sellers')}")
print(f"SET @cid = SCOPE_IDENTITY(): {count('SET @cid = SCOPE_IDENTITY()')}")
print(f"DECLARE @cid:          {count('DECLARE @cid')}")
print(f"BEGIN TRAN:            {count('BEGIN TRAN')}")
print(f"COMMIT:                {count('COMMIT;')}")

# Robust quote-balance: walk the file character by character, tracking whether
# we're inside a T-SQL string literal (' ... '' escape ... ').
inside = False
n = len(text)
i = 0
opens = 0
line_no = 1
last_open_line = 0
while i < n:
    ch = text[i]
    if ch == "\n":
        line_no += 1
    if ch == "'":
        # Escaped '' inside a string
        if inside and i + 1 < n and text[i+1] == "'":
            i += 2
            continue
        if not inside:
            opens += 1
            last_open_line = line_no
            inside = True
        else:
            inside = False
        i += 1
        continue
    i += 1

print(f"String literals opened: {opens}")
print(f"String literals closed: {opens if not inside else opens - 1}")
print(f"Currently inside a string at EOF: {inside}")
if inside:
    print(f"  Last opened at line {last_open_line}")

# Look for any remaining oddities:
# - '' followed by identifier characters directly (missing quote?)
odd_pattern = re.compile(r"''\w")
odd_hits = odd_pattern.findall(text)
print(f"'' immediately followed by word char: {len(odd_hits)}")

# Check that everything after COMMIT is just a PRINT
tail = text.rsplit("COMMIT;", 1)[1] if "COMMIT;" in text else ""
print(f"After COMMIT: {tail.strip()[:100]!r}")
