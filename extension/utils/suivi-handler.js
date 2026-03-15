// ============================================================
// Suivi AGV Handler - Historical tracking file management
// Section D of the specification
// ============================================================
const SuiviHandler = {

  SHEET_NAME: 'Suivi AGV',

  // ── Merge cleaned data into master Suivi AGV file ──
  async mergeIntoSuivi(suiviWorkbook, cleanedData, weekDate) {
    const dateStr = weekDate || new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    let wb, existingRows;

    if (suiviWorkbook) {
      wb = suiviWorkbook;
      const sheetName = wb.SheetNames.includes(this.SHEET_NAME) ? this.SHEET_NAME : wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      existingRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      wb = XLSX.utils.book_new();
      existingRows = [];
    }

    // Add date column and source to new data
    const newRows = cleanedData.rows.map(row => ({
      'Date Semaine': dateStr,
      'Source': 'eBulletin',
      ...row
    }));

    // Deduplicate: if same IATA code + same week date exists, update instead of append
    const iataCol = this._findIataColumn(cleanedData.headers);
    const merged = [...existingRows];
    let updated = 0;
    let added = 0;

    for (const newRow of newRows) {
      const iataCode = iataCol ? String(newRow[iataCol] || '').trim() : '';
      const existingIdx = iataCode ? merged.findIndex(r =>
        String(r[iataCol] || '').trim() === iataCode &&
        String(r['Date Semaine'] || '') === dateStr
      ) : -1;

      if (existingIdx >= 0) {
        merged[existingIdx] = newRow;
        updated++;
      } else {
        merged.push(newRow);
        added++;
      }
    }

    // Build the merged sheet
    const mergedHeaders = this._buildHeaders(existingRows, newRows);
    const sheetData = [mergedHeaders];

    for (const row of merged) {
      sheetData.push(mergedHeaders.map(h => row[h] || ''));
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = mergedHeaders.map(h => ({ wch: Math.max(h.length + 2, 14) }));

    // Replace or add the sheet
    if (wb.SheetNames.includes(this.SHEET_NAME)) {
      wb.Sheets[this.SHEET_NAME] = ws;
    } else {
      XLSX.utils.book_append_sheet(wb, ws, this.SHEET_NAME);
    }

    return {
      workbook: wb,
      stats: {
        existingRows: existingRows.length,
        newRows: newRows.length,
        updated,
        added,
        totalRows: merged.length,
        date: dateStr
      }
    };
  },

  // ── Load Suivi file from upload ──
  async loadSuiviFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          resolve(wb);
        } catch (err) {
          reject(new Error(`Erreur lecture fichier Suivi: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Erreur lecture fichier'));
      reader.readAsArrayBuffer(file);
    });
  },

  // ── Get historical summary from Suivi file ──
  getSuiviSummary(workbook) {
    const sheetName = workbook.SheetNames.includes(this.SHEET_NAME) ? this.SHEET_NAME : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Group by week date
    const weekMap = new Map();
    for (const row of rows) {
      const date = String(row['Date Semaine'] || '').trim();
      if (!date) continue;
      if (!weekMap.has(date)) weekMap.set(date, []);
      weekMap.get(date).push(row);
    }

    const weeks = [];
    for (const [date, weekRows] of weekMap) {
      weeks.push({
        date,
        count: weekRows.length,
        countries: new Set(weekRows.map(r => String(r['Country'] || r['Pays'] || r['BSP Country'] || '').trim()).filter(Boolean)).size
      });
    }

    weeks.sort((a, b) => {
      // Parse dd/mm/yyyy
      const [da, ma, ya] = a.date.split('/').map(Number);
      const [db, mb, yb] = b.date.split('/').map(Number);
      return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
    });

    return {
      totalRows: rows.length,
      totalWeeks: weeks.length,
      weeks,
      headers: Object.keys(rows[0] || {})
    };
  },

  // ── Download Suivi file ──
  downloadSuivi(workbook, fileName) {
    if (!fileName) {
      fileName = `Suivi_AGV_${new Date().toISOString().slice(0, 10)}.xlsx`;
    }
    XLSX.writeFile(workbook, fileName);
  },

  // ── Helpers ──
  _findIataColumn(headers) {
    const patterns = [/iata\s*code/i, /code\s*iata/i, /agency\s*code/i, /iata/i];
    for (const h of headers) {
      for (const p of patterns) {
        if (p.test(h)) return h;
      }
    }
    return headers[0];
  },

  _buildHeaders(existingRows, newRows) {
    const headerSet = new Set();
    // Prioritize: Date Semaine first, then Source, then existing, then new
    headerSet.add('Date Semaine');
    headerSet.add('Source');

    if (existingRows.length > 0) {
      for (const key of Object.keys(existingRows[0])) {
        headerSet.add(key);
      }
    }
    if (newRows.length > 0) {
      for (const key of Object.keys(newRows[0])) {
        headerSet.add(key);
      }
    }

    return Array.from(headerSet);
  }
};
