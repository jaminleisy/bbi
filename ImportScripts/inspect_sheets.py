"""Print headers and sample rows for each target sheet."""
import openpyxl

WB_PATH = r"C:\BenBotInventory\Builds.xlsx"

SHEETS = ["Builds", "Bulk 2026", "2025 Builds", "Bulk 2025", "2024 Builds", "Bulk 2024"]

wb = openpyxl.load_workbook(WB_PATH, data_only=True)

for name in SHEETS:
    ws = wb[name]
    print(f"==== {name}  ({ws.max_row} rows x {ws.max_column} cols) ====")
    for c in range(1, ws.max_column + 1):
        print(f"  col {c}: {ws.cell(row=1, column=c).value!r}")
    print()
