(function () {
  if (!location.href.includes('traveler-tasks')) {
    alert('Navigate to your Bitjita traveler tasks page first.\n\nhttps://bitjita.com/players/<your-id>/traveler-tasks');
    return;
  }

  // ── Extract traveler names from tab buttons ──────────────────────────────
  // ── Find the tab container via the traveler buttons ─────────────────────
  // Structure: tabContainer > [buttonBar, panel1, panel2, ..., panel6]
  // Traveler tab buttons match "Name N" (single word + digit count).
  // ────────────────────────────────────────────────────────────────────────────
  const travelerButtons = [...document.querySelectorAll('button')]
    .filter(b => b.textContent.trim().match(/^[A-Za-z]+\s+\d+$/));

  if (!travelerButtons.length) {
    alert('Could not find traveler tabs. Make sure you are on the traveler tasks page.');
    return;
  }

  const buttonBar = travelerButtons[0].closest('div');
  const tabContainer = buttonBar?.parentElement;

  if (!tabContainer) {
    alert('Could not find traveler tab structure. Page layout may have changed.');
    return;
  }

  const panels = [...tabContainer.children].filter(c => c !== buttonBar); // one panel per traveler

  // Extract traveler names from the button bar in order
  const travelerNames = [...buttonBar.querySelectorAll('button')]
    .map(b => { const m = b.textContent.trim().match(/^([A-Za-z]+)\s+\d+$/); return m ? m[1] : null; })
    .filter(Boolean);

  // ── Extract items from each panel ────────────────────────────────────────
  const rows = [];

  panels.forEach((panel, i) => {
    const traveler = travelerNames[i] || `Traveler${i + 1}`;
    panel.querySelectorAll('a[href]').forEach(el => {
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/(items|cargo)\/(\d+)$/);
      if (!m) return;

      const txt = el.textContent.replace(/\s+/g, ' ').trim();
      if (txt.includes('Hex Coin')) return;

      // Strip leading icon abbreviation e.g. "MO ", "RT ", "BH "
      const clean = txt.replace(/^[A-Z]{1,3}\s+/, '');
      const qm = clean.match(/^(\d+)x\s+(.+?)(?:\s+T\d+)?\s+(Common|Uncommon|Rare|Epic|Mythic|Default)/i);
      if (!qm) return;

      // Find task description by walking up the DOM
      let desc = '', anc = el;
      for (let j = 0; j < 10; j++) {
        anc = anc.parentElement;
        if (!anc) break;
        const s = anc.querySelector('span[class*="flex-1"], span[class*="text-base"]');
        if (s) { desc = s.textContent.trim(); break; }
      }

      rows.push({
        traveler,
        task: desc,
        item: qm[2].trim(),
        qty: +qm[1],
        rarity: qm[3],
        id: m[2],
        type: m[1], // "items" or "cargo"
      });
    });
  });

  if (!rows.length) {
    alert('No tasks found. Make sure you are on the traveler tasks page.');
    return;
  }

  // ── Remove existing modal if re-running ─────────────────────────────────
  document.getElementById('bcm-overlay')?.remove();

  // ── Build modal ──────────────────────────────────────────────────────────
  const css = `
    #bcm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}
    #bcm-modal{background:#12121e;color:#ddd;border-radius:12px;padding:24px;max-width:92vw;width:900px;max-height:85vh;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.7)}
    #bcm-modal h2{margin:0 0 4px;font-size:1.15rem;color:#f0a500;letter-spacing:.03em}
    #bcm-modal p{margin:0 0 14px;font-size:.78rem;color:#666}
    #bcm-btns{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
    #bcm-btns button{padding:5px 14px;border:none;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600}
    #bcm-close{background:#8b1a1a;color:#fff}
    #bcm-copy{background:#1a5c35;color:#fff}
    #bcm-csv{background:#1a3a6c;color:#fff}
    #bcm-modal table{border-collapse:collapse;width:100%;font-size:.8rem}
    #bcm-modal th{background:#1e1e38;color:#f0a500;padding:7px 11px;text-align:left;position:sticky;top:0;white-space:nowrap}
    #bcm-modal td{padding:5px 11px;border-bottom:1px solid #1e1e2e;vertical-align:top}
    #bcm-modal tr:hover td{background:#181828}
    .bcm-qty{text-align:right;font-weight:700;color:#7ec8e3;white-space:nowrap}
    .bcm-id{font-family:monospace;font-size:.73rem;color:#777}
    .bcm-cargo{color:#e09050}
    .bcm-task{font-size:.75rem;color:#999;max-width:260px}
  `;

  const resetEl = document.querySelector('span[class*="countdown"], [class*="reset"]');
  const resetText = resetEl ? ' • ' + resetEl.closest('div')?.textContent?.trim() : '';

  const thead = `<tr>
    <th>Traveler</th><th>Item</th><th>Qty</th><th>Rarity</th><th>Item ID</th><th>Task</th>
  </tr>`;

  const tbody = rows.map(r => {
    const idClass = r.type === 'cargo' ? 'bcm-id bcm-cargo' : 'bcm-id';
    const idLabel = (r.type === 'cargo' ? 'cargo:' : '') + r.id;
    return `<tr>
      <td>${r.traveler}</td>
      <td>${r.item}</td>
      <td class="bcm-qty">${r.qty}</td>
      <td>${r.rarity}</td>
      <td class="${idClass}">${idLabel}</td>
      <td class="bcm-task">${r.task}</td>
    </tr>`;
  }).join('');

  const toTSV = () => [
    'Traveler\tItem\tQty\tRarity\tItem ID\tTask',
    ...rows.map(r => [r.traveler, r.item, r.qty, r.rarity, (r.type === 'cargo' ? 'cargo:' : '') + r.id, r.task].join('\t'))
  ].join('\n');

  const toCSV = () => [
    'Traveler,Item,Qty,Rarity,Item ID,Task',
    ...rows.map(r => [
      r.traveler, r.item, r.qty, r.rarity,
      (r.type === 'cargo' ? 'cargo:' : '') + r.id,
      '"' + r.task.replace(/"/g, '""') + '"'
    ].join(','))
  ].join('\n');

  const div = document.createElement('div');
  div.id = 'bcm-overlay';
  div.innerHTML = `
    <style>${css}</style>
    <div id="bcm-modal">
      <h2>Bitcraft Coin Minter — Traveler Tasks</h2>
      <p>${rows.length} items across ${travelerNames.length} travelers${resetText}</p>
      <div id="bcm-btns">
        <button id="bcm-close">✕ Close</button>
        <button id="bcm-copy">⎘ Copy TSV</button>
        <button id="bcm-csv">↓ Download CSV</button>
      </div>
      <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    </div>`;

  document.body.appendChild(div);

  document.getElementById('bcm-close').onclick = () => div.remove();
  div.onclick = e => { if (e.target === div) div.remove(); };

  document.getElementById('bcm-copy').onclick = () => {
    navigator.clipboard.writeText(toTSV()).then(() => {
      const btn = document.getElementById('bcm-copy');
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = '⎘ Copy TSV'; }, 2000);
    });
  };

  document.getElementById('bcm-csv').onclick = () => {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(toCSV());
    a.download = 'traveler-tasks.csv';
    a.click();
  };
})();
