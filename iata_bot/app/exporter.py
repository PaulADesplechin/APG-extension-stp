"""
APG BSPLink Bot — Excel Report Generator
Creates the final XLSX with SUMMARY tab + one tab per country.
"""

import logging
from datetime import datetime
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

logger = logging.getLogger("exporter")

# Styles
HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
HEADER_FILL = PatternFill(start_color="2B3A67", end_color="2B3A67", fill_type="solid")
OK_FILL = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
MISMATCH_FILL = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
CHECK_FILL = PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid")
NEW_FILL = PatternFill(start_color="B4C6E7", end_color="B4C6E7", fill_type="solid")
NOT_IN_FILL = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
THIN_BORDER = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)

COLUMNS = [
    "BSP",
    "Agent Code",
    "Agent Name",
    "eBulletin Section",
    "Change Code",
    "Country",
    "BSPLink Action",
    "Discrepancy",
]

DISCREPANCY_STYLES = {
    "OK": OK_FILL,
    "MISMATCH": MISMATCH_FILL,
    "CHECK MANUALLY": CHECK_FILL,
    "NEW APPLICATION": NEW_FILL,
    "NOT IN BULLETIN": NOT_IN_FILL,
}


def _style_header(ws, num_cols: int):
    """Apply header styling to the first row."""
    for col in range(1, num_cols + 1):
        cell = ws.cell(row=1, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER


def _style_data_rows(ws, num_rows: int, num_cols: int):
    """Apply conditional styling to data rows based on Discrepancy value."""
    disc_col = None
    for col in range(1, num_cols + 1):
        if ws.cell(row=1, column=col).value == "Discrepancy":
            disc_col = col
            break

    if not disc_col:
        return

    for row in range(2, num_rows + 1):
        disc_value = ws.cell(row=row, column=disc_col).value or ""
        fill = DISCREPANCY_STYLES.get(disc_value.strip())

        for col in range(1, num_cols + 1):
            cell = ws.cell(row=row, column=col)
            cell.border = THIN_BORDER
            cell.alignment = Alignment(vertical="center")

        if fill:
            # Color the Discrepancy cell
            ws.cell(row=row, column=disc_col).fill = fill


def _auto_width(ws, num_cols: int):
    """Auto-adjust column widths."""
    for col in range(1, num_cols + 1):
        max_length = 0
        letter = get_column_letter(col)
        for row in ws.iter_rows(min_col=col, max_col=col, values_only=False):
            for cell in row:
                val = str(cell.value or "")
                max_length = max(max_length, len(val))
        ws.column_dimensions[letter].width = min(max_length + 3, 40)


def _write_sheet(ws, rows: list[dict]):
    """Write rows to a worksheet."""
    # Header
    for col_idx, col_name in enumerate(COLUMNS, 1):
        ws.cell(row=1, column=col_idx, value=col_name)

    # Data
    for row_idx, row in enumerate(rows, 2):
        for col_idx, col_name in enumerate(COLUMNS, 1):
            ws.cell(row=row_idx, column=col_idx, value=row.get(col_name, ""))

    num_rows = len(rows) + 1
    _style_header(ws, len(COLUMNS))
    _style_data_rows(ws, num_rows, len(COLUMNS))
    _auto_width(ws, len(COLUMNS))

    # Freeze top row
    ws.freeze_panes = "A2"

    # Auto-filter
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{num_rows}"


def generate_report(
    all_results: dict[str, list[dict]],
    output_dir: str = "output"
) -> str:
    """Generate the final Excel report.

    Args:
        all_results: {country_code: [result_rows]}
        output_dir: Directory for output file

    Returns:
        Path to the generated Excel file
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"IATA_BSPLink_Report_{timestamp}.xlsx"
    filepath = str(Path(output_dir) / filename)

    wb = Workbook()

    # ---- SUMMARY sheet (all MISMATCH rows) ----
    ws_summary = wb.active
    ws_summary.title = "SUMMARY"

    mismatch_rows = []
    for country_code in sorted(all_results.keys()):
        for row in all_results[country_code]:
            disc = (row.get("Discrepancy", "") or "").strip().upper()
            if disc == "MISMATCH":
                mismatch_rows.append(row)

    # Sort by country
    mismatch_rows.sort(key=lambda r: (r.get("BSP", ""), r.get("Agent Code", "")))
    _write_sheet(ws_summary, mismatch_rows)

    # Add summary stats at the top via a separate info sheet
    ws_stats = wb.create_sheet("STATS", 1)
    stats_headers = ["Country", "Total Agents", "OK", "MISMATCH", "CHECK MANUALLY", "NEW APPLICATION", "NOT IN BULLETIN"]
    for col_idx, h in enumerate(stats_headers, 1):
        ws_stats.cell(row=1, column=col_idx, value=h)

    stat_row = 2
    for country_code in sorted(all_results.keys()):
        rows = all_results[country_code]
        counts = {"OK": 0, "MISMATCH": 0, "CHECK MANUALLY": 0, "NEW APPLICATION": 0, "NOT IN BULLETIN": 0}
        for r in rows:
            disc = (r.get("Discrepancy", "") or "").strip().upper()
            if disc in counts:
                counts[disc] += 1

        ws_stats.cell(row=stat_row, column=1, value=country_code)
        ws_stats.cell(row=stat_row, column=2, value=len(rows))
        ws_stats.cell(row=stat_row, column=3, value=counts["OK"])
        ws_stats.cell(row=stat_row, column=4, value=counts["MISMATCH"])
        ws_stats.cell(row=stat_row, column=5, value=counts["CHECK MANUALLY"])
        ws_stats.cell(row=stat_row, column=6, value=counts["NEW APPLICATION"])
        ws_stats.cell(row=stat_row, column=7, value=counts["NOT IN BULLETIN"])
        stat_row += 1

    _style_header(ws_stats, len(stats_headers))
    _auto_width(ws_stats, len(stats_headers))
    ws_stats.freeze_panes = "A2"

    # ---- Per-country sheets ----
    for country_code in sorted(all_results.keys()):
        rows = all_results[country_code]
        # Sheet name max 31 chars
        sheet_name = country_code[:31]
        ws = wb.create_sheet(title=sheet_name)
        _write_sheet(ws, rows)

    wb.save(filepath)
    logger.info(f"Report saved: {filepath}")
    return filepath
