// ============================================================
// Action Analyzer - Business logic for OPENED/CLOSED/NO ACTION
// Section G of the specification - Confidence scoring
// ============================================================
const ActionAnalyzer = {

  // Action types
  ACTIONS: {
    OPENED: 'OPENED',
    CLOSED: 'CLOSED',
    NO_ACTION: 'NO ACTION',
    REVIEW: 'REVIEW',
    UNKNOWN: 'UNKNOWN'
  },

  // ── Main entry: analyze all rows ──
  analyzeAll(rows, columnMapping, bspResults) {
    return rows.map((row, idx) => {
      const analysis = this.analyzeRow(row, columnMapping, bspResults);
      return {
        rowIndex: idx,
        iataCode: String(row[columnMapping.iataCode] || '').trim(),
        country: String(row[columnMapping.country] || '').trim(),
        ...analysis
      };
    });
  },

  // ── Analyze a single row ──
  analyzeRow(row, mapping, bspResults) {
    const signals = this.collectSignals(row, mapping, bspResults);
    const decision = this.makeDecision(signals);
    return {
      action: decision.action,
      confidence: decision.confidence,
      signals,
      reasoning: decision.reasoning
    };
  },

  // ── Collect all decision signals from the row ──
  collectSignals(row, mapping, bspResults) {
    const iataCode = String(row[mapping.iataCode] || '').trim();
    const signals = {};

    // Signal 1: Change Code from eBulletin (NEW, CHG, REM, etc.)
    const changeCodeCol = mapping.changeCode || this._findCol(row, [/^change\s*code$/i, /^code\s*chang/i]);
    if (changeCodeCol && row[changeCodeCol] !== undefined) {
      const code = String(row[changeCodeCol]).trim().toUpperCase();
      signals.changeCode = code;

      if (code === 'NEW') {
        signals.changeCodeAction = this.ACTIONS.OPENED;
      } else if (code === 'CHG') {
        signals.changeCodeAction = this.ACTIONS.REVIEW;
      } else if (code === 'REM' || code === 'DEL' || code === 'TER') {
        signals.changeCodeAction = this.ACTIONS.CLOSED;
      }
    }

    // Signal 1b: Section column (Passenger/Cargo = category, but OPEN/CLOSED = action)
    const sectionCol = mapping.section || this._findCol(row, [/^section$/i]);
    if (sectionCol && row[sectionCol] !== undefined) {
      const section = String(row[sectionCol]).trim().toUpperCase();
      signals.section = section;

      // Only use as action signal if it contains action keywords (not category names)
      if (section.includes('OPEN') || section === '1' || section === 'A') {
        signals.sectionAction = this.ACTIONS.OPENED;
      } else if (section.includes('CLOS') || section.includes('TERMIN') || section === '2' || section === 'B') {
        signals.sectionAction = this.ACTIONS.CLOSED;
      } else if (section === '0' || section === '' || section.includes('NO ACTION')) {
        signals.sectionAction = this.ACTIONS.NO_ACTION;
      }
      // Passenger, Cargo, etc. are categories, not action signals → no sectionAction set
    }

    // Signal 2: Risk Status (numeric 0-10 or text: Standard, Under Review, etc.)
    const riskCol = mapping.riskStatus || this._findCol(row, [/^risk\s*status$/i]);
    if (riskCol && row[riskCol] !== undefined) {
      const raw = String(row[riskCol]).trim();
      const riskVal = Number(raw);
      if (!isNaN(riskVal) && raw !== '') {
        signals.riskStatus = riskVal;
        if (riskVal === 0) signals.riskAction = this.ACTIONS.NO_ACTION;
        else if (riskVal >= 7) signals.riskAction = this.ACTIONS.REVIEW;
        else if (riskVal >= 4) signals.riskAction = this.ACTIONS.CLOSED;
      } else {
        // Text-based risk status
        const riskText = raw.toUpperCase();
        signals.riskStatusText = raw;
        if (riskText.includes('UNDER REVIEW') || riskText.includes('REVIEW')) {
          signals.riskAction = this.ACTIONS.REVIEW;
        } else if (riskText.includes('HIGH') || riskText.includes('CRITICAL') || riskText.includes('DEFAULTING')) {
          signals.riskAction = this.ACTIONS.CLOSED;
        }
        // 'Standard' = no action needed → no riskAction set
      }
    }

    // Signal 3: IRR (Accumulated Irregularities)
    const irrCol = mapping.irr || this._findCol(row, [/^irr$/i, /^irregularit/i]);
    if (irrCol && row[irrCol] !== undefined) {
      const irrVal = Number(row[irrCol]);
      if (!isNaN(irrVal)) {
        signals.irr = irrVal;
        if (irrVal > 0) signals.irrFlag = true;
      }
    }

    // Signal 4: Accreditation Type
    const accredCol = this._findCol(row, [/^accreditation\s*type$/i, /^type\s*accr/i]);
    if (accredCol && row[accredCol] !== undefined) {
      signals.accreditationType = String(row[accredCol]).trim();
    }

    // Signal 5: BSP Link TA verification results
    if (bspResults) {
      const bspResult = bspResults.find(r => r.iataCode === iataCode);
      if (bspResult) {
        signals.bspAgentStatus = bspResult.agentStatus;
        signals.bspTicketingAuthority = bspResult.ticketingAuthority;
        signals.bspLookupStatus = bspResult.lookupStatus;

        if (bspResult.agentStatus === 'Active' && bspResult.ticketingAuthority === 'Enabled') {
          signals.bspAction = this.ACTIONS.OPENED;
        } else if (bspResult.agentStatus === 'Inactive' || bspResult.ticketingAuthority === 'Disabled') {
          signals.bspAction = this.ACTIONS.CLOSED;
        }
      }
    }

    // Signal 6: Explicit action column if present
    const actionCol = mapping.actions || this._findCol(row, [/^actions?$/i]);
    if (actionCol && row[actionCol] !== undefined) {
      const actionVal = String(row[actionCol]).trim().toUpperCase();
      signals.explicitAction = actionVal;
      if (actionVal === 'OPENED') signals.explicitActionType = this.ACTIONS.OPENED;
      else if (actionVal === 'CLOSED') signals.explicitActionType = this.ACTIONS.CLOSED;
      else if (actionVal === 'NO ACTION') signals.explicitActionType = this.ACTIONS.NO_ACTION;
    }

    return signals;
  },

  // ── Decision engine with confidence scoring ──
  makeDecision(signals) {
    const votes = [];
    const reasoning = [];

    // Weight each signal
    if (signals.explicitActionType) {
      votes.push({ action: signals.explicitActionType, weight: 5 });
      reasoning.push(`Action explicite: ${signals.explicitAction} (poids 5)`);
    }

    if (signals.changeCodeAction) {
      votes.push({ action: signals.changeCodeAction, weight: 4 });
      reasoning.push(`Change Code: ${signals.changeCode} -> ${signals.changeCodeAction} (poids 4)`);
    }

    if (signals.sectionAction) {
      votes.push({ action: signals.sectionAction, weight: 3 });
      reasoning.push(`Section: ${signals.section} -> ${signals.sectionAction} (poids 3)`);
    }

    if (signals.bspAction) {
      votes.push({ action: signals.bspAction, weight: 4 });
      reasoning.push(`BSP Link: Agent=${signals.bspAgentStatus}, TA=${signals.bspTicketingAuthority} -> ${signals.bspAction} (poids 4)`);
    }

    if (signals.riskAction) {
      votes.push({ action: signals.riskAction, weight: 2 });
      const riskLabel = signals.riskStatusText || signals.riskStatus;
      reasoning.push(`Risk Status: ${riskLabel} -> ${signals.riskAction} (poids 2)`);
    }

    if (signals.irrFlag) {
      votes.push({ action: this.ACTIONS.REVIEW, weight: 1 });
      reasoning.push(`IRR: ${signals.irr} irregularites -> REVIEW (poids 1)`);
    }

    if (votes.length === 0) {
      return {
        action: this.ACTIONS.UNKNOWN,
        confidence: 0,
        reasoning: ['Aucun signal disponible pour determiner l\'action']
      };
    }

    // Tally weighted votes
    const tally = {};
    let totalWeight = 0;
    for (const vote of votes) {
      tally[vote.action] = (tally[vote.action] || 0) + vote.weight;
      totalWeight += vote.weight;
    }

    // Find winner
    let winner = this.ACTIONS.UNKNOWN;
    let maxWeight = 0;
    for (const [action, weight] of Object.entries(tally)) {
      if (weight > maxWeight) {
        maxWeight = weight;
        winner = action;
      }
    }

    // Confidence = winner weight / total weight, scaled to 0-100
    const confidence = Math.round((maxWeight / totalWeight) * 100);

    // Check for conflicts (reduces confidence display)
    const actionCount = Object.keys(tally).length;
    const hasConflict = actionCount > 1;
    if (hasConflict) {
      reasoning.push(`CONFLIT: ${actionCount} actions differentes detectees`);
    }

    return {
      action: winner,
      confidence,
      reasoning
    };
  },

  // ── Generate summary statistics ──
  getSummary(analyses) {
    const counts = { OPENED: 0, CLOSED: 0, 'NO ACTION': 0, REVIEW: 0, UNKNOWN: 0 };
    let totalConfidence = 0;
    let highConfidence = 0;
    let lowConfidence = 0;
    let conflicts = 0;

    for (const a of analyses) {
      counts[a.action] = (counts[a.action] || 0) + 1;
      totalConfidence += a.confidence;
      if (a.confidence >= 80) highConfidence++;
      if (a.confidence < 50) lowConfidence++;
      if (a.reasoning.some(r => r.includes('CONFLIT'))) conflicts++;
    }

    return {
      counts,
      averageConfidence: analyses.length > 0 ? Math.round(totalConfidence / analyses.length) : 0,
      highConfidence,
      lowConfidence,
      conflicts,
      total: analyses.length
    };
  },

  // ── Helper ──
  _findCol(row, patterns) {
    for (const key of Object.keys(row)) {
      for (const pat of patterns) {
        if (pat.test(key)) return key;
      }
    }
    return null;
  }
};
