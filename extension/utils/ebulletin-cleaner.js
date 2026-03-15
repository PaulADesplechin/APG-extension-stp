// eBulletin Cleaner - Cleans raw IATA eBulletin Excel files
// Uses global XLSX (SheetJS) for cell-level manipulation
const EbulletinCleaner = {

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Find a column letter whose header matches one of the given regex patterns.
   * Scans the first row of the sheet.
   * @param {Object} sheet  SheetJS worksheet
   * @param {RegExp[]} patterns  Array of RegExp to test against header text
   * @returns {string|null} Column letter (e.g. "C") or null
   */
  findColumnByName(sheet, patterns) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      const cell = sheet[addr];
      if (!cell) continue;
      const value = String(cell.v || '').trim();
      for (const pat of patterns) {
        if (pat.test(value)) {
          return XLSX.utils.encode_col(c);
        }
      }
    }
    return null;
  },

  /**
   * Shift all columns from startCol index onwards to the right by count positions.
   * Operates in reverse order to avoid overwriting.
   * @param {Object} sheet  SheetJS worksheet
   * @param {number} startCol  0-based column index to start shifting from
   * @param {number} count  Number of positions to shift right
   */
  shiftColumnsRight(sheet, startCol, count) {
    const range = XLSX.utils.decode_range(sheet['!ref']);

    // Iterate from rightmost column to startCol (reverse to avoid overwrite)
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.e.c; c >= startCol; c--) {
        const srcAddr = XLSX.utils.encode_cell({ r, c });
        const dstAddr = XLSX.utils.encode_cell({ r, c: c + count });
        if (sheet[srcAddr]) {
          sheet[dstAddr] = Object.assign({}, sheet[srcAddr]);
          delete sheet[srcAddr];
        } else {
          delete sheet[dstAddr];
        }
      }
    }

    // Update the range to reflect new width
    range.e.c += count;
    sheet['!ref'] = XLSX.utils.encode_range(range);

    // Shift column widths if present
    if (sheet['!cols']) {
      const cols = sheet['!cols'];
      for (let i = 0; i < count; i++) {
        cols.splice(startCol, 0, { wch: 14 });
      }
    }
  },

  /**
   * Extract structured data from a sheet.
   * @param {Object} sheet  SheetJS worksheet
   * @returns {{ headers: string[], rows: Object[], range: string }}
   */
  getSheetData(sheet) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headers = [];

    // Read header row
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
      const cell = sheet[addr];
      headers.push(cell ? String(cell.v || '').trim() : '');
    }

    // Read data rows as objects keyed by header
    const rows = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row = {};
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        row[headers[c - range.s.c]] = cell ? cell.v : '';
      }
      rows.push(row);
    }

    return { headers, rows, range: sheet['!ref'] };
  },

  // ── Core cleaning steps ──────────────────────────────────────────────

  /**
   * Remove all rows where the Agency Code column is empty or blank.
   * Recognises: "Agency Code", "Agency code", "AGENCY CODE", "Code Agence".
   * @param {Object} sheet  SheetJS worksheet
   * @returns {number} Number of rows removed
   */
  removeEmptyAgencyCodes(sheet) {
    const patterns = [
      /^agency\s*code$/i,
      /^code\s*agence$/i
    ];
    const colLetter = this.findColumnByName(sheet, patterns);
    if (!colLetter) return 0;

    const colIndex = XLSX.utils.decode_col(colLetter);
    const range = XLSX.utils.decode_range(sheet['!ref']);

    // Collect row indices (data rows only) where agency code is empty
    const emptyRows = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: colIndex });
      const cell = sheet[addr];
      const val = cell ? String(cell.v || '').trim() : '';
      if (val === '') {
        emptyRows.push(r);
      }
    }

    if (emptyRows.length === 0) return 0;

    // Build set for fast lookup
    const emptySet = new Set(emptyRows);

    // Compact: copy non-empty rows upward
    let writeRow = range.s.r + 1;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      if (emptySet.has(r)) continue;
      if (r !== writeRow) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const srcAddr = XLSX.utils.encode_cell({ r, c });
          const dstAddr = XLSX.utils.encode_cell({ r: writeRow, c });
          if (sheet[srcAddr]) {
            sheet[dstAddr] = Object.assign({}, sheet[srcAddr]);
          } else {
            delete sheet[dstAddr];
          }
        }
      }
      writeRow++;
    }

    // Clear leftover rows at the bottom
    for (let r = writeRow; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        delete sheet[XLSX.utils.encode_cell({ r, c })];
      }
    }

    // Update range
    range.e.r = writeRow - 1;
    sheet['!ref'] = XLSX.utils.encode_range(range);

    return emptyRows.length;
  },

  /**
   * Insert two new columns at positions A and B:
   *   A ("IATA Code 7") = first 7 characters of the original Agency Code (column C before insertion, now column E)
   *   B ("Check Digit")  = last character of the Agency Code
   * All existing columns are shifted right by 2.
   * @param {Object} sheet  SheetJS worksheet
   */
  insertCodeColumns(sheet) {
    const range = XLSX.utils.decode_range(sheet['!ref']);

    // Before shifting, locate the Agency Code column (expected at C = index 2)
    const agencyPatterns = [/^agency\s*code$/i, /^code\s*agence$/i];
    const agencyColLetter = this.findColumnByName(sheet, agencyPatterns);
    const agencyColIndex = agencyColLetter ? XLSX.utils.decode_col(agencyColLetter) : 2;

    // Shift all existing columns right by 2 (from column 0)
    this.shiftColumnsRight(sheet, 0, 2);

    // The agency code column is now at agencyColIndex + 2
    const shiftedAgencyCol = agencyColIndex + 2;

    // Re-read the updated range
    const newRange = XLSX.utils.decode_range(sheet['!ref']);

    // Write headers in A1 and B1
    sheet[XLSX.utils.encode_cell({ r: newRange.s.r, c: 0 })] = { t: 's', v: 'IATA Code 7' };
    sheet[XLSX.utils.encode_cell({ r: newRange.s.r, c: 1 })] = { t: 's', v: 'Check Digit' };

    // Fill data rows
    for (let r = newRange.s.r + 1; r <= newRange.e.r; r++) {
      const agencyAddr = XLSX.utils.encode_cell({ r, c: shiftedAgencyCol });
      const agencyCell = sheet[agencyAddr];
      const agencyValue = agencyCell ? String(agencyCell.v || '').trim() : '';

      // Column A: first 7 chars
      const iata7 = agencyValue.length >= 7 ? agencyValue.substring(0, 7) : agencyValue;
      sheet[XLSX.utils.encode_cell({ r, c: 0 })] = { t: 's', v: iata7 };

      // Column B: last character (check digit)
      const checkDigit = agencyValue.length > 0 ? agencyValue.charAt(agencyValue.length - 1) : '';
      sheet[XLSX.utils.encode_cell({ r, c: 1 })] = { t: 's', v: checkDigit };
    }
  },

  /**
   * "Paste special multiply by 1" - converts text representations of numbers
   * to actual numeric cells in the given column.
   * @param {Object} sheet  SheetJS worksheet
   * @param {string} colLetter  Column letter (e.g. "F")
   * @returns {number} Number of cells converted
   */
  coerceToNumbers(sheet, colLetter) {
    if (!colLetter) return 0;

    const colIndex = XLSX.utils.decode_col(colLetter);
    const range = XLSX.utils.decode_range(sheet['!ref']);
    let converted = 0;

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: colIndex });
      const cell = sheet[addr];
      if (!cell) continue;

      const raw = String(cell.v || '').trim();
      if (raw === '') continue;

      // Try to parse as number
      const num = Number(raw);
      if (!isNaN(num) && raw !== '') {
        // Only convert if the cell is currently stored as text
        if (cell.t === 's' || cell.t === 'str') {
          sheet[addr] = { t: 'n', v: num };
          converted++;
        }
      }
    }

    return converted;
  },

  /**
   * Find the "Risk Status" column and coerce its values to numbers.
   * @param {Object} sheet  SheetJS worksheet
   * @returns {number} Number of cells converted
   */
  applyRiskStatusFix(sheet) {
    const patterns = [/^risk\s*status$/i, /^statut\s*risque$/i, /^risk$/i];
    const col = this.findColumnByName(sheet, patterns);
    if (!col) return 0;
    return this.coerceToNumbers(sheet, col);
  },

  /**
   * Find the "IRR" / "Accumulated Irregularities" column and coerce to numbers.
   * @param {Object} sheet  SheetJS worksheet
   * @returns {number} Number of cells converted
   */
  applyIRRFix(sheet) {
    const patterns = [
      /^irr$/i,
      /^accumulated\s*irregularities$/i,
      /^irregularit[eé]s?\s*accumul[eé]es?$/i
    ];
    const col = this.findColumnByName(sheet, patterns);
    if (!col) return 0;
    return this.coerceToNumbers(sheet, col);
  },

  /**
   * Copy non-empty (visible) values from one column to another.
   * Equivalent of Excel "copy visible cells only".
   * @param {Object} sheet  SheetJS worksheet
   * @param {string} fromCol  Source column letter
   * @param {string} toCol    Destination column letter
   * @returns {number} Number of cells copied
   */
  copyVisibleData(sheet, fromCol, toCol) {
    if (!fromCol || !toCol) return 0;

    const fromIndex = XLSX.utils.decode_col(fromCol);
    const toIndex = XLSX.utils.decode_col(toCol);
    const range = XLSX.utils.decode_range(sheet['!ref']);
    let copied = 0;

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const srcAddr = XLSX.utils.encode_cell({ r, c: fromIndex });
      const cell = sheet[srcAddr];
      if (!cell) continue;

      const val = String(cell.v || '').trim();
      if (val === '') continue;

      const dstAddr = XLSX.utils.encode_cell({ r, c: toIndex });
      sheet[dstAddr] = Object.assign({}, cell);
      copied++;
    }

    return copied;
  },

  /**
   * Return summary statistics comparing original and cleaned sheets.
   * @param {Object} originalSheet  SheetJS worksheet (before cleaning)
   * @param {Object} cleanedSheet   SheetJS worksheet (after cleaning)
   * @returns {{ rowsRemoved: number, columnsInserted: number, cellsConverted: number, totalRows: number }}
   */
  getCleaningSummary(originalSheet, cleanedSheet) {
    const origRange = XLSX.utils.decode_range(originalSheet['!ref']);
    const cleanRange = XLSX.utils.decode_range(cleanedSheet['!ref']);

    const origRows = origRange.e.r - origRange.s.r; // exclude header
    const cleanRows = cleanRange.e.r - cleanRange.s.r;
    const origCols = origRange.e.c - origRange.s.c + 1;
    const cleanCols = cleanRange.e.c - cleanRange.s.c + 1;

    // Count numeric cells in cleaned sheet (those that were likely converted)
    let cellsConverted = 0;
    for (let r = cleanRange.s.r + 1; r <= cleanRange.e.r; r++) {
      for (let c = cleanRange.s.c; c <= cleanRange.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = cleanedSheet[addr];
        if (cell && cell.t === 'n') cellsConverted++;
      }
    }

    return {
      rowsRemoved: origRows - cleanRows,
      columnsInserted: cleanCols - origCols,
      cellsConverted,
      totalRows: cleanRows
    };
  },

  // ── Main entry point ─────────────────────────────────────────────────

  /**
   * Clean an entire workbook. Processes the first sheet through all steps.
   * @param {Object} workbook  SheetJS workbook
   * @returns {Object} A new cleaned SheetJS workbook
   */
  cleanWorkbook(workbook) {
    // Work on the first sheet
    const sheetName = workbook.SheetNames[0];
    const originalSheet = workbook.Sheets[sheetName];

    // Deep-clone the sheet so we don't mutate the original
    const clonedWb = XLSX.utils.book_new();
    const clonedData = XLSX.utils.sheet_to_json(originalSheet, { header: 1, defval: '' });
    const sheet = XLSX.utils.aoa_to_sheet(clonedData);

    // Copy column widths and merges if present
    if (originalSheet['!cols']) sheet['!cols'] = JSON.parse(JSON.stringify(originalSheet['!cols']));
    if (originalSheet['!merges']) sheet['!merges'] = JSON.parse(JSON.stringify(originalSheet['!merges']));

    // Step 1: Remove rows with empty Agency Code
    const rowsRemoved = this.removeEmptyAgencyCodes(sheet);

    // Step 2: Insert IATA Code 7 and Check Digit columns
    this.insertCodeColumns(sheet);

    // Step 3: Fix Risk Status (coerce text to numbers)
    const riskConverted = this.applyRiskStatusFix(sheet);

    // Step 4: Fix IRR (coerce text to numbers)
    const irrConverted = this.applyIRRFix(sheet);

    // Build the cleaned workbook
    XLSX.utils.book_append_sheet(clonedWb, sheet, sheetName);

    // Attach cleaning metadata for downstream use
    clonedWb._cleaningStats = {
      rowsRemoved,
      riskCellsConverted: riskConverted,
      irrCellsConverted: irrConverted
    };

    return clonedWb;
  }
};
