"""Peek at 2025 Builds row 320."""
import openpyxl

wb = openpyxl.load_workbook(r"C:\BenBotInventory\Builds.xlsx", data_only=True)
ws = wb["2025 Builds"]

for r in [320, 321]:
    print(f"--- 2025 Builds row {r} ---")
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=r, column=c).value
        if v is not None and v != "":
            head = ws.cell(row=1, column=c).value
            print(f"  col {c:2d} ({head!r}): {v!r}")
    print()
