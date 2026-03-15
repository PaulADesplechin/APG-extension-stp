// ============================================================
// Email Template Generator - Draft emails for associates
// Section K of the specification
// ============================================================
const EmailTemplate = {

  // ── Generate full email HTML ──
  generateEmail(actionsTable, recipientName, senderName) {
    const deadline = actionsTable.deadline;
    const summary = actionsTable.summary;

    return `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #333; line-height: 1.6; margin: 0; padding: 20px; }
  .header { background: #2D2F6D; color: white; padding: 20px 30px; border-radius: 8px 8px 0 0; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; color: #a0a0b0; font-size: 14px; }
  .content { background: #f9f9f9; padding: 30px; border: 1px solid #e0e0e0; }
  .deadline { background: #fff3e0; border: 1px solid #ffe0b2; border-radius: 6px; padding: 12px 20px; margin: 16px 0; font-weight: bold; color: #e65100; }
  .summary-grid { display: flex; gap: 12px; margin: 16px 0; }
  .summary-box { flex: 1; text-align: center; padding: 16px; border-radius: 6px; border: 1px solid #e0e0e0; background: white; }
  .summary-box .value { font-size: 28px; font-weight: bold; }
  .summary-box .label { font-size: 12px; color: #666; text-transform: uppercase; }
  .box-opened .value { color: #2e7d32; }
  .box-closed .value { color: #c62828; }
  .box-review .value { color: #e65100; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { background: #2D2F6D; color: white; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
  td { padding: 10px 12px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #fafafa; }
  .action-opened { color: #2e7d32; font-weight: bold; }
  .action-closed { color: #c62828; font-weight: bold; }
  .action-review { color: #e65100; font-weight: bold; }
  .priority-high { background: #ffebee; }
  .confidence-bar { display: inline-block; height: 8px; border-radius: 4px; background: #4A55A2; }
  .footer { padding: 20px 30px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999; }
  .footer a { color: #4A55A2; }
</style>
</head>
<body>
<div class="header">
  <h1>TA ACTIONS TO BE DONE BEFORE ${this._escHtml(deadline)}</h1>
  <p>APG Airlines - Risk Management Department</p>
</div>
<div class="content">
  <p>Bonjour${recipientName ? ' ' + this._escHtml(recipientName) : ''},</p>
  <p>Veuillez trouver ci-dessous les actions Ticketing Authority a effectuer suite au traitement de l'eBulletin IATA de cette semaine.</p>

  <div class="deadline">Date limite d'execution : ${this._escHtml(deadline)}</div>

  <div class="summary-grid">
    <div class="summary-box box-opened">
      <div class="value">${summary.opened}</div>
      <div class="label">OPENED</div>
    </div>
    <div class="summary-box box-closed">
      <div class="value">${summary.closed}</div>
      <div class="label">CLOSED</div>
    </div>
    <div class="summary-box box-review">
      <div class="value">${summary.review}</div>
      <div class="label">REVIEW</div>
    </div>
    <div class="summary-box">
      <div class="value">${summary.totalActions}</div>
      <div class="label">TOTAL</div>
    </div>
  </div>

  ${summary.highPriority > 0 ? `<p><strong style="color: #c62828;">Attention : ${summary.highPriority} action(s) en priorite haute.</strong></p>` : ''}

  <table>
    <thead>
      <tr>
        <th>Code IATA</th>
        <th>Pays</th>
        <th>Agent</th>
        <th>Action</th>
        <th>Priorite</th>
        <th>Confiance</th>
      </tr>
    </thead>
    <tbody>
      ${actionsTable.rows.map(row => `
      <tr class="${row.priority === 'high' ? 'priority-high' : ''}">
        <td><strong>${this._escHtml(row.iataCode)}</strong></td>
        <td>${this._escHtml(row.country)}</td>
        <td>${this._escHtml(row.agentName)}</td>
        <td class="action-${row.requiredAction.toLowerCase()}">${this._escHtml(row.requiredAction)}</td>
        <td>${row.priority.toUpperCase()}</td>
        <td>
          <span class="confidence-bar" style="width: ${row.confidence * 0.6}px"></span>
          ${row.confidence}%
        </td>
      </tr>`).join('')}
    </tbody>
  </table>

  <p>Merci de traiter ces actions dans BSP Link avant la date limite indiquee.</p>
  <p>Pour toute question, n'hesitez pas a revenir vers moi.</p>
  <p>Cordialement,<br>${senderName ? this._escHtml(senderName) : 'APG Airlines - Risk Management'}</p>
</div>
<div class="footer">
  <p>Ce rapport a ete genere automatiquement par APG BSP Link Checker le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR')}.</p>
  <p>Les donnees proviennent de l'eBulletin IATA et de BSP Link. Verifiez toujours les actions sur BSP Link avant execution.</p>
</div>
</body>
</html>`;
  },

  // ── Generate plain text version ──
  generatePlainText(actionsTable, recipientName, senderName) {
    const deadline = actionsTable.deadline;
    const summary = actionsTable.summary;

    let text = `TA ACTIONS TO BE DONE BEFORE ${deadline}\n`;
    text += `APG Airlines - Risk Management\n`;
    text += `${'='.repeat(50)}\n\n`;
    text += `Bonjour${recipientName ? ' ' + recipientName : ''},\n\n`;
    text += `Veuillez trouver ci-dessous les actions TA de cette semaine.\n\n`;
    text += `DATE LIMITE: ${deadline}\n\n`;
    text += `RESUME:\n`;
    text += `  OPENED:  ${summary.opened}\n`;
    text += `  CLOSED:  ${summary.closed}\n`;
    text += `  REVIEW:  ${summary.review}\n`;
    text += `  TOTAL:   ${summary.totalActions}\n`;

    if (summary.highPriority > 0) {
      text += `\n  /!\\ ${summary.highPriority} ACTION(S) EN PRIORITE HAUTE\n`;
    }

    text += `\n${'─'.repeat(50)}\n`;
    text += `${'Code IATA'.padEnd(14)} ${'Pays'.padEnd(12)} ${'Action'.padEnd(12)} ${'Priorite'.padEnd(10)} Confiance\n`;
    text += `${'─'.repeat(50)}\n`;

    for (const row of actionsTable.rows) {
      text += `${row.iataCode.padEnd(14)} ${row.country.padEnd(12)} ${row.requiredAction.padEnd(12)} ${row.priority.toUpperCase().padEnd(10)} ${row.confidence}%\n`;
    }

    text += `${'─'.repeat(50)}\n\n`;
    text += `Cordialement,\n${senderName || 'APG Airlines - Risk Management'}\n`;

    return text;
  },

  // ── Copy email to clipboard ──
  async copyToClipboard(html) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        return true;
      }
    } catch (e) {
      // Fallback: copy as text
      const text = html.replace(/<[^>]+>/g, '');
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  },

  // ── Open in default email client ──
  openMailto(actionsTable, recipientEmail, senderName) {
    const subject = encodeURIComponent(`TA Actions - ${actionsTable.deadline} - APG Airlines`);
    const body = encodeURIComponent(this.generatePlainText(actionsTable, '', senderName));
    const mailto = `mailto:${recipientEmail || ''}?subject=${subject}&body=${body}`;
    window.open(mailto, '_blank');
  },

  _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};
