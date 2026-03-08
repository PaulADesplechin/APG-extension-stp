// Excel parsing and writing using SheetJS (XLSX)
const ExcelHandler = {
  // Parse uploaded file (xlsx, xls, csv) -> { headers, rows, sheetName }
  parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

          if (json.length === 0) {
            reject(new Error('Le fichier est vide'));
            return;
          }

          const headers = Object.keys(json[0]);
          resolve({ headers, rows: json, sheetName, totalSheets: workbook.SheetNames.length });
        } catch (err) {
          reject(new Error('Erreur de lecture du fichier: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsArrayBuffer(file);
    });
  },

  // Auto-detect which columns are IATA code and country
  detectColumns(headers) {
    const iataPatterns = ['iata', 'agency.?code', 'agent.?code', 'code.?iata', 'iata.?code'];
    const countryPatterns = ['country', 'pays', 'bsp.?country', 'country.?code', 'code.?pays'];
    const namePatterns = ['agency.?name', 'agent.?name', 'nom', 'name', 'trade.?name', 'legal.?name'];
    const sectionPatterns = ['section', 'change.?code', 'type'];

    const detect = (patterns) => {
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, 'i');
        const match = headers.find(h => regex.test(h));
        if (match) return match;
      }
      return '';
    };

    return {
      iataCode: detect(iataPatterns),
      country: detect(countryPatterns),
      agencyName: detect(namePatterns),
      section: detect(sectionPatterns)
    };
  },

  // Extract clean IATA code (7 digits) from various formats
  cleanIataCode(raw) {
    const str = String(raw).trim();
    // Remove non-alphanumeric
    const digits = str.replace(/[^0-9]/g, '');
    // 8 digits = 7 IATA + 1 check digit
    if (digits.length === 8) return digits.substring(0, 7);
    // 7 digits = IATA code
    if (digits.length === 7) return digits;
    // Return as-is if unexpected format
    return str;
  },

  // Group rows by country for batch processing
  groupByCountry(rows, iataColumn, countryColumn) {
    const groups = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const country = String(row[countryColumn] || 'XX').trim().toUpperCase();
      const iataCode = this.cleanIataCode(row[iataColumn]);
      if (!iataCode) continue;
      if (!groups[country]) groups[country] = [];
      groups[country].push({ iataCode, rowIndex: i, row });
    }
    return groups;
  },

  // Create enriched Excel with new status columns
  createEnrichedExcel(originalRows, headers, results) {
    // Build result lookup by rowIndex
    const resultMap = {};
    for (const r of results) {
      resultMap[r.rowIndex] = r;
    }

    // New headers
    const newHeaders = [
      ...headers,
      'Agent Status (BSP)',
      'Ticketing Authority',
      'Lookup Status',
      'Lookup Date'
    ];

    // Build enriched rows
    const enrichedRows = originalRows.map((row, i) => {
      const result = resultMap[i];
      return {
        ...row,
        'Agent Status (BSP)': result?.agentStatus || '',
        'Ticketing Authority': result?.ticketingAuthority || '',
        'Lookup Status': result?.lookupStatus || 'skipped',
        'Lookup Date': result ? new Date().toLocaleDateString('fr-FR') : ''
      };
    });

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(enrichedRows, { header: newHeaders });

    // Style the new columns header (bold) - SheetJS free doesn't support full styling
    // but we can set column widths
    const colWidths = newHeaders.map(h => ({ wch: Math.max(h.length + 2, 12) }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BSP Link Results');

    return wb;
  },

  // Download workbook as .xlsx file
  downloadWorkbook(workbook, filename) {
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `BSP_Link_Results_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
