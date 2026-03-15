// ============================================================
// Anomaly Detector - Detects BSP/IATA anomalies in eBulletin data
// Sections E & F of the specification
// ============================================================
const AnomalyDetector = {

  // ── Main entry: run all anomaly checks ──
  analyzeAll(rows, headers, columnMapping) {
    const results = {
      bspAnomalies: this.checkBSPColumn(rows, columnMapping),
      actionAnomalies: this.checkActionsColumn(rows, columnMapping),
      naValues: this.checkNAValues(rows, headers),
      duplicates: this.findDuplicates(rows, columnMapping),
      noActionRows: this.findNoActionRows(rows, columnMapping),
      riskAnomalies: this.checkRiskStatus(rows, columnMapping),
      summary: {}
    };

    results.summary = {
      totalAnomalies:
        results.bspAnomalies.length +
        results.actionAnomalies.length +
        results.naValues.length +
        results.duplicates.length,
      totalNoAction: results.noActionRows.length,
      severityCounts: this.countSeverities(results)
    };

    return results;
  },

  // ── E.1 Check BSP column for anomalies ──
  checkBSPColumn(rows, mapping) {
    const col = mapping.bspCountry || mapping.country;
    if (!col) return [];

    const anomalies = [];
    const validBSP = new Set(Object.keys(typeof BSP_COUNTRY_MAPPING !== 'undefined' ? BSP_COUNTRY_MAPPING : {}));

    rows.forEach((row, idx) => {
      const val = String(row[col] || '').trim();

      if (!val) {
        anomalies.push({
          row: idx + 2,
          type: 'bsp_empty',
          severity: 'high',
          column: col,
          value: '',
          message: `Ligne ${idx + 2}: Code BSP vide`
        });
      } else if (validBSP.size > 0 && !validBSP.has(val) && !validBSP.has(val.toUpperCase())) {
        anomalies.push({
          row: idx + 2,
          type: 'bsp_unknown',
          severity: 'medium',
          column: col,
          value: val,
          message: `Ligne ${idx + 2}: Code BSP inconnu "${val}"`
        });
      }
    });

    return anomalies;
  },

  // ── E.2 Check ACTIONS column ──
  checkActionsColumn(rows, mapping) {
    const col = mapping.actions || this._findColumn(rows, [/^actions?$/i, /^action\s*type$/i]);
    if (!col) return [];

    const validActions = new Set([
      'OPENED', 'CLOSED', 'NO ACTION', 'REVIEW', 'SUSPENDED',
      'REINSTATED', 'NEW DEFAULT', 'REMOVAL OF DEFAULT',
      'CHANGE OF OWNERSHIP', 'TERMINATION', 'VOLUNTARY RELINQUISHMENT'
    ]);

    const anomalies = [];
    rows.forEach((row, idx) => {
      const val = String(row[col] || '').trim().toUpperCase();
      if (!val) return;

      if (!validActions.has(val)) {
        anomalies.push({
          row: idx + 2,
          type: 'action_unknown',
          severity: 'medium',
          column: col,
          value: val,
          message: `Ligne ${idx + 2}: Action inconnue "${val}"`
        });
      }
    });

    return anomalies;
  },

  // ── E.3 Check for N/A values across all columns ──
  checkNAValues(rows, headers) {
    const naPatterns = [/^n\/?a$/i, /^#n\/a$/i, /^-$/i, /^none$/i, /^null$/i, /^undefined$/i];
    const anomalies = [];

    rows.forEach((row, idx) => {
      headers.forEach(header => {
        const val = String(row[header] || '').trim();
        for (const pat of naPatterns) {
          if (pat.test(val)) {
            anomalies.push({
              row: idx + 2,
              type: 'na_value',
              severity: 'low',
              column: header,
              value: val,
              message: `Ligne ${idx + 2}, colonne "${header}": Valeur N/A "${val}"`
            });
            break;
          }
        }
      });
    });

    return anomalies;
  },

  // ── E.4 Find duplicate IATA codes ──
  findDuplicates(rows, mapping) {
    const col = mapping.iataCode;
    if (!col) return [];

    const seen = new Map();
    rows.forEach((row, idx) => {
      const code = String(row[col] || '').trim();
      if (!code) return;
      if (!seen.has(code)) {
        seen.set(code, []);
      }
      seen.get(code).push(idx + 2);
    });

    const anomalies = [];
    for (const [code, rowNums] of seen) {
      if (rowNums.length > 1) {
        anomalies.push({
          type: 'duplicate',
          severity: 'high',
          column: col,
          value: code,
          rows: rowNums,
          message: `Code IATA "${code}" en double aux lignes ${rowNums.join(', ')}`
        });
      }
    }

    return anomalies;
  },

  // ── F. Find "No Action" rows ──
  findNoActionRows(rows, mapping) {
    const sectionCol = mapping.section || this._findColumn(rows, [/^section$/i, /^change\s*code$/i]);
    const actionCol = mapping.actions || this._findColumn(rows, [/^actions?$/i]);
    const riskCol = mapping.riskStatus || this._findColumn(rows, [/^risk\s*status$/i]);

    const noActionRows = [];

    rows.forEach((row, idx) => {
      let isNoAction = false;
      let reason = '';

      // Check explicit "No action" in section/action columns
      if (sectionCol) {
        const sectionVal = String(row[sectionCol] || '').trim().toLowerCase();
        if (sectionVal.includes('no action') || sectionVal === '0' || sectionVal === '') {
          isNoAction = true;
          reason = 'Section = No Action';
        }
      }

      if (actionCol) {
        const actionVal = String(row[actionCol] || '').trim().toLowerCase();
        if (actionVal === 'no action' || actionVal === '') {
          isNoAction = true;
          reason = reason ? reason + ' + Action vide' : 'Action = No Action';
        }
      }

      // Risk Status = 0 or empty usually means no action needed
      if (riskCol) {
        const riskVal = String(row[riskCol] || '').trim();
        if (riskVal === '0' || riskVal === '') {
          if (!isNoAction) {
            isNoAction = true;
            reason = 'Risk Status = 0';
          }
        }
      }

      if (isNoAction) {
        noActionRows.push({
          row: idx + 2,
          iataCode: row[mapping.iataCode] || '',
          country: row[mapping.country] || '',
          reason,
          data: row
        });
      }
    });

    return noActionRows;
  },

  // ── E.5 Check Risk Status for anomalies ──
  checkRiskStatus(rows, mapping) {
    const col = mapping.riskStatus || this._findColumn(rows, [/^risk\s*status$/i]);
    if (!col) return [];

    const anomalies = [];
    rows.forEach((row, idx) => {
      const val = String(row[col] || '').trim();
      if (!val) return;

      const num = Number(val);
      if (isNaN(num)) {
        anomalies.push({
          row: idx + 2,
          type: 'risk_non_numeric',
          severity: 'medium',
          column: col,
          value: val,
          message: `Ligne ${idx + 2}: Risk Status non numerique "${val}"`
        });
      } else if (num < 0 || num > 10) {
        anomalies.push({
          row: idx + 2,
          type: 'risk_out_of_range',
          severity: 'high',
          column: col,
          value: val,
          message: `Ligne ${idx + 2}: Risk Status hors limites (${val})`
        });
      }
    });

    return anomalies;
  },

  // ── Severity counter ──
  countSeverities(results) {
    const all = [
      ...results.bspAnomalies,
      ...results.actionAnomalies,
      ...results.naValues,
      ...results.riskAnomalies
    ];
    // Flatten duplicates into individual items
    results.duplicates.forEach(d => {
      all.push({ severity: d.severity });
    });

    return {
      high: all.filter(a => a.severity === 'high').length,
      medium: all.filter(a => a.severity === 'medium').length,
      low: all.filter(a => a.severity === 'low').length
    };
  },

  // ── Helper: find column name from rows ──
  _findColumn(rows, patterns) {
    if (!rows || rows.length === 0) return null;
    const keys = Object.keys(rows[0]);
    for (const key of keys) {
      for (const pat of patterns) {
        if (pat.test(key)) return key;
      }
    }
    return null;
  }
};
