// ============================================================
// Output Generator - Creates final TA Actions table + Excel
// Section J of the specification
// ============================================================
const OutputGenerator = {

  // ── Generate the "TA ACTIONS TO BE DONE BEFORE [DATE]" table ──
  generateActionsTable(analyses, bspResults, deadline) {
    if (!deadline) {
      // Default: next Friday
      const d = new Date();
      d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
      deadline = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    const actionRows = analyses
      .filter(a => a.action !== 'NO ACTION' && a.action !== 'UNKNOWN')
      .map(a => {
        const bsp = bspResults?.find(r => r.iataCode === a.iataCode) || {};
        return {
          iataCode: a.iataCode,
          country: a.country,
          agentName: bsp.agentName || '-',
          currentStatus: bsp.agentStatus || '-',
          currentTA: bsp.ticketingAuthority || '-',
          requiredAction: a.action,
          confidence: a.confidence,
          reasoning: a.reasoning.join('; '),
          priority: this._getPriority(a)
        };
      })
      .sort((a, b) => {
        // Sort by priority (high first), then by action type
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const diff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
        if (diff !== 0) return diff;
        return a.requiredAction.localeCompare(b.requiredAction);
      });

    return {
      title: `TA ACTIONS TO BE DONE BEFORE ${deadline}`,
      deadline,
      generatedAt: new Date().toISOString(),
      rows: actionRows,
      summary: {
        totalActions: actionRows.length,
        opened: actionRows.filter(r => r.requiredAction === 'OPENED').length,
        closed: actionRows.filter(r => r.requiredAction === 'CLOSED').length,
        review: actionRows.filter(r => r.requiredAction === 'REVIEW').length,
        highPriority: actionRows.filter(r => r.priority === 'high').length
      }
    };
  },

  // ── Create downloadable Excel with all sheets ──
  createFullReport(originalData, cleaningStats, anomalies, analyses, actionsTable, bspResults) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: TA Actions (main output)
    this._addActionsSheet(wb, actionsTable);

    // Sheet 2: Full enriched data
    this._addEnrichedSheet(wb, originalData, analyses, bspResults);

    // Sheet 3: Anomalies report
    this._addAnomaliesSheet(wb, anomalies);

    // Sheet 4: Analysis detail
    this._addAnalysisSheet(wb, analyses);

    // Sheet 5: Summary
    this._addSummarySheet(wb, cleaningStats, anomalies, analyses, actionsTable);

    return wb;
  },

  // ── Sheet 1: TA Actions ──
  _addActionsSheet(wb, actionsTable) {
    const data = [
      [actionsTable.title],
      [],
      ['Code IATA', 'Pays', 'Nom Agent', 'Statut Actuel', 'TA Actuelle', 'Action Requise', 'Priorite', 'Confiance', 'Raisonnement']
    ];

    for (const row of actionsTable.rows) {
      data.push([
        row.iataCode,
        row.country,
        row.agentName,
        row.currentStatus,
        row.currentTA,
        row.requiredAction,
        row.priority.toUpperCase(),
        `${row.confidence}%`,
        row.reasoning
      ]);
    }

    // Add summary at bottom
    data.push([]);
    data.push(['RESUME']);
    data.push(['Total actions', actionsTable.summary.totalActions]);
    data.push(['OPENED', actionsTable.summary.opened]);
    data.push(['CLOSED', actionsTable.summary.closed]);
    data.push(['REVIEW', actionsTable.summary.review]);
    data.push(['Priorite haute', actionsTable.summary.highPriority]);

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Column widths
    ws['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 14 },
      { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 50 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'TA Actions');
  },

  // ── Sheet 2: Full enriched data ──
  _addEnrichedSheet(wb, originalData, analyses, bspResults) {
    const headers = [
      ...originalData.headers,
      'Agent Status (BSP)',
      'Ticketing Authority',
      'Action Recommandee',
      'Confiance',
      'Lookup Status'
    ];

    const data = [headers];

    originalData.rows.forEach((row, idx) => {
      const analysis = analyses[idx] || {};
      const bsp = bspResults?.find(r => r.iataCode === analysis.iataCode) || {};

      const rowData = originalData.headers.map(h => row[h] || '');
      rowData.push(
        bsp.agentStatus || '-',
        bsp.ticketingAuthority || '-',
        analysis.action || '-',
        analysis.confidence ? `${analysis.confidence}%` : '-',
        bsp.lookupStatus || '-'
      );
      data.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Donnees Enrichies');
  },

  // ── Sheet 3: Anomalies ──
  _addAnomaliesSheet(wb, anomalies) {
    const data = [
      ['Rapport d\'Anomalies'],
      [],
      ['Type', 'Severite', 'Ligne', 'Colonne', 'Valeur', 'Message']
    ];

    const allAnomalies = [
      ...anomalies.bspAnomalies,
      ...anomalies.actionAnomalies,
      ...anomalies.naValues,
      ...anomalies.riskAnomalies
    ];

    // Add duplicates as individual rows
    anomalies.duplicates.forEach(d => {
      allAnomalies.push({
        type: d.type,
        severity: d.severity,
        row: d.rows.join(', '),
        column: d.column,
        value: d.value,
        message: d.message
      });
    });

    allAnomalies.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 };
      return (sev[a.severity] || 2) - (sev[b.severity] || 2);
    });

    for (const a of allAnomalies) {
      data.push([
        a.type,
        a.severity.toUpperCase(),
        a.row || '-',
        a.column || '-',
        a.value || '-',
        a.message
      ]);
    }

    data.push([]);
    data.push(['Total anomalies', allAnomalies.length]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 60 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Anomalies');
  },

  // ── Sheet 4: Analysis detail ──
  _addAnalysisSheet(wb, analyses) {
    const data = [
      ['Analyse Detaillee par Code IATA'],
      [],
      ['Code IATA', 'Pays', 'Action', 'Confiance', 'Signaux', 'Raisonnement']
    ];

    for (const a of analyses) {
      const signalSummary = Object.entries(a.signals)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');

      data.push([
        a.iataCode,
        a.country,
        a.action,
        `${a.confidence}%`,
        signalSummary,
        a.reasoning.join(' | ')
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 40 }, { wch: 60 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Analyse');
  },

  // ── Sheet 5: Summary ──
  _addSummarySheet(wb, cleaningStats, anomalies, analyses, actionsTable) {
    const analysisSummary = ActionAnalyzer.getSummary(analyses);

    const data = [
      ['RAPPORT DE SYNTHESE - APG BSP Link Checker'],
      [`Genere le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR')}`],
      [],
      ['=== NETTOYAGE ==='],
      ['Lignes supprimees (Agency Code vide)', cleaningStats?.rowsRemoved || 0],
      ['Cellules Risk Status converties', cleaningStats?.riskCellsConverted || 0],
      ['Cellules IRR converties', cleaningStats?.irrCellsConverted || 0],
      [],
      ['=== ANOMALIES ==='],
      ['BSP anomalies', anomalies?.bspAnomalies?.length || 0],
      ['Action anomalies', anomalies?.actionAnomalies?.length || 0],
      ['Valeurs N/A', anomalies?.naValues?.length || 0],
      ['Doublons', anomalies?.duplicates?.length || 0],
      ['Lignes "No Action"', anomalies?.noActionRows?.length || 0],
      [],
      ['=== ANALYSE ==='],
      ['Total codes analyses', analysisSummary.total],
      ['OPENED', analysisSummary.counts.OPENED || 0],
      ['CLOSED', analysisSummary.counts.CLOSED || 0],
      ['NO ACTION', analysisSummary.counts['NO ACTION'] || 0],
      ['REVIEW', analysisSummary.counts.REVIEW || 0],
      ['Confiance moyenne', `${analysisSummary.averageConfidence}%`],
      ['Haute confiance (>=80%)', analysisSummary.highConfidence],
      ['Conflits detectes', analysisSummary.conflicts],
      [],
      ['=== ACTIONS TA ==='],
      ['Total actions requises', actionsTable?.summary?.totalActions || 0],
      ['Priorite haute', actionsTable?.summary?.highPriority || 0],
      ['Date limite', actionsTable?.deadline || '-']
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Synthese');
  },

  // ── Download helper ──
  downloadReport(wb, fileName) {
    if (!fileName) {
      fileName = `APG_eBulletin_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    }
    XLSX.writeFile(wb, fileName);
  },

  // ── Priority helper ──
  _getPriority(analysis) {
    if (analysis.action === 'REVIEW') return 'high';
    if (analysis.confidence >= 80 && analysis.action === 'CLOSED') return 'high';
    if (analysis.confidence >= 60) return 'medium';
    return 'low';
  }
};
