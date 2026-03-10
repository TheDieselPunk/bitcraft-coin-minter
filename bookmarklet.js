(function () {
  const HEADERS = { 'x-app-identifier': 'BitcraftCoinMinter' };

  // ── Claim ID — prompt once, persist in localStorage ─────────────────────────
  let claimId = localStorage.getItem('bcm_claim_id');
  if (!claimId) {
    claimId = prompt('Enter your Claim Entity ID\n(found in your Bitjita claim URL, e.g. bitjita.com/claims/864691128472806646):');
    if (!claimId) return;
    claimId = claimId.trim();
    localStorage.setItem('bcm_claim_id', claimId);
  }

  // ── Player ID — auto-detect from URL or prompt ───────────────────────────────
  const urlMatch = location.pathname.match(/\/players\/(\d+)/);
  const playerId = urlMatch?.[1] ?? prompt('Enter your Player Entity ID\n(from your Bitjita profile URL, e.g. bitjita.com/players/1008806316549363686):');
  if (!playerId) return;

  // ── Remove stale modal ───────────────────────────────────────────────────────
  document.getElementById('bcm-overlay')?.remove();

  // ── Show loading skeleton, then run ─────────────────────────────────────────
  showModal(null, null, 0, 0);
  run(playerId, claimId, HEADERS);

  // ── Orchestrator ─────────────────────────────────────────────────────────────
  async function run(playerId, claimId, headers) {
    let tasksData, citizensData, marketData, myInvData;
    try {
      [tasksData, citizensData, marketData, myInvData] = await Promise.all([
        apiFetch(`/api/players/${playerId}/traveler-tasks`, headers),
        apiFetch(`/api/claims/${claimId}/citizens`, headers),
        apiFetch(`/api/market?q=&hasSellOrders=true&claimEntityId=${claimId}`, headers),
        apiFetch(`/api/players/${playerId}/inventories`, headers),
      ]);
    } catch (err) {
      setStatus(`⚠ Failed to load data: ${err.message}`);
      return;
    }

    const rows = buildRows(tasksData);
    if (!rows.length) {
      setStatus('No incomplete tasks found.');
      return;
    }

    showModal(rows, tasksData.expirationTimestamp, citizensData.count ?? citizensData.citizens?.length ?? '?', rows.length);

    // Enrichment runs in parallel — updates cells in-place as data arrives
    enrichInventory(rows, myInvData);
    enrichMarket(rows, marketData, headers);
    enrichTraders(rows, citizensData, headers);
  }

  // ── Build task rows from API data ────────────────────────────────────────────
  function buildRows(tasksData) {
    const rows = [];
    for (const task of (tasksData.tasks || [])) {
      if (task.completed) continue;
      const traveler = (task.description || '').split(' ')[0] || 'Unknown';
      for (const req of (task.requiredItems || [])) {
        if (req.item_id === 1) continue; // skip Hex Coin reward
        const isCargo = req.item_type === 'cargo';
        const lookup = isCargo ? tasksData.cargo : tasksData.items;
        const info = lookup?.[req.item_id] ?? {};
        rows.push({
          traveler,
          task:   task.description || '',
          item:   info.name || String(req.item_id),
          qty:    req.quantity,
          id:     String(req.item_id),
          type:   req.item_type,    // "item" or "cargo"
          rarity: info.rarityStr || '',
          tier:   info.tier ?? '',
        });
      }
    }
    return rows;
  }

  // ── Player inventory enrichment ───────────────────────────────────────────────
  function enrichInventory(rows, myInvData) {
    // Build map: itemId string → [{location, qty}]
    const invMap = {};
    for (const inv of (myInvData?.inventories || [])) {
      const loc = inv.inventoryName || 'Unknown';
      for (const pocket of (inv.pockets || [])) {
        const c = pocket.contents;
        if (!c) continue;
        const key = String(c.itemId);
        if (!invMap[key]) invMap[key] = [];
        invMap[key].push({ loc, qty: c.quantity });
      }
    }

    rows.forEach((row, i) => {
      const el = document.getElementById(`bcm-inv-${i}`);
      if (!el) return;
      const slots = invMap[row.id] || [];
      if (!slots.length) {
        el.innerHTML = `<span class="bcm-no">—</span>`;
        return;
      }
      const total = slots.reduce((s, e) => s + e.qty, 0);
      const enough = total >= row.qty;
      const cls = enough ? 'bcm-inv-full' : 'bcm-inv-partial';
      const detail = slots
        .map(e => `${escHtml(e.loc)} <span class="bcm-trd-qty">(${e.qty.toLocaleString()})</span>`)
        .join(', ');
      el.innerHTML = `<span class="${cls}" title="Total: ${total.toLocaleString()} / ${row.qty.toLocaleString()} needed">${detail}</span>`;
    });
  }

  // ── Market enrichment — claim presence + global lowest price ─────────────────
  async function enrichMarket(rows, marketData, headers) {
    const marketSet = new Set((marketData?.data?.items || []).map(i => String(i.id)));

    // Fetch prices only for items actually listed at the claim
    const uniqueIds = [...new Set(
      rows
        .filter(r => r.type !== 'cargo' && marketSet.has(r.id))
        .map(r => r.id)
    )];

    const priceMap = {};
    await Promise.all(uniqueIds.map(async id => {
      const d = await apiFetch(`/api/items/${id}`, headers).catch(() => null);
      priceMap[id] = d?.marketStats?.lowestSellPrice ?? null;
    }));

    rows.forEach((row, i) => {
      const el = document.getElementById(`bcm-mkt-${i}`);
      if (!el) return;
      if (row.type === 'cargo') {
        el.innerHTML = `<span class="bcm-na">cargo</span>`;
        return;
      }
      if (marketSet.has(row.id)) {
        const price = priceMap[row.id];
        const priceStr = price != null
          ? ` <span class="bcm-price">${price.toLocaleString()}¢</span>`
          : '';
        el.innerHTML = `<span class="bcm-yes">✓</span>${priceStr}`;
      } else {
        el.innerHTML = `<span class="bcm-no">—</span>`;
      }
    });
  }

  // ── Trader enrichment — fetch all citizen inventories ────────────────────────
  async function enrichTraders(rows, citizensData, headers) {
    const citizens = citizensData.citizens || [];

    setStatus(`Fetching ${citizens.length} trader inventories…`);

    const invResults = await Promise.all(
      citizens.map(c =>
        apiFetch(`/api/players/${c.entityId}/inventories`, headers).catch(() => null)
      )
    );

    // Build map: itemId string → [{name, qty}]
    const traderMap = {};
    citizens.forEach((citizen, i) => {
      const inv = invResults[i];
      if (!inv) return;
      const stands = (inv.inventories || []).filter(x =>
        (x.inventoryName || '').includes('Trader Stand')
      );
      for (const stand of stands) {
        for (const pocket of (stand.pockets || [])) {
          const c = pocket.contents;
          if (!c) continue;
          const key = String(c.itemId);
          if (!traderMap[key]) traderMap[key] = [];
          traderMap[key].push({ name: citizen.userName, qty: c.quantity });
        }
      }
    });

    rows.forEach((row, i) => {
      const el = document.getElementById(`bcm-trd-${i}`);
      if (!el) return;
      const matches = (traderMap[row.id] || []).filter(e => e.qty >= row.qty);
      if (matches.length) {
        el.innerHTML = `<span class="bcm-names">${matches.map(e =>
          `${escHtml(e.name)} <span class="bcm-trd-qty">(${e.qty.toLocaleString()})</span>`
        ).join(', ')}</span>`;
      } else {
        el.innerHTML = `<span class="bcm-no">—</span>`;
      }
    });

    setStatus('');
  }

  // ── Render modal ─────────────────────────────────────────────────────────────
  function showModal(rows, expiry, citizenCount, rowCount) {
    document.getElementById('bcm-overlay')?.remove();

    const css = `
      #bcm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}
      #bcm-modal{background:#12121e;color:#ddd;border-radius:12px;padding:24px;max-width:96vw;width:1300px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.8)}
      #bcm-modal h2{margin:0 0 3px;font-size:1.15rem;color:#f0a500;letter-spacing:.03em}
      #bcm-meta{font-size:.75rem;color:#666;margin-bottom:12px}
      #bcm-btns{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
      #bcm-btns button{padding:5px 14px;border:none;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600}
      #bcm-close{background:#8b1a1a;color:#fff}
      #bcm-copy{background:#1a5c35;color:#fff}
      #bcm-csv{background:#1a3a6c;color:#fff}
      #bcm-clr{background:#333;color:#aaa;font-weight:400}
      #bcm-status{font-size:.73rem;color:#888;margin-left:4px}
      #bcm-tbl-wrap{overflow:auto;flex:1}
      #bcm-modal table{border-collapse:collapse;width:100%;font-size:.8rem}
      #bcm-modal th{background:#1e1e38;color:#f0a500;padding:7px 11px;text-align:left;position:sticky;top:0;white-space:nowrap;z-index:1}
      #bcm-modal td{padding:5px 11px;border-bottom:1px solid #1a1a2c;vertical-align:middle}
      #bcm-modal tr:hover td{background:#181828}
      .bcm-qty{text-align:right;font-weight:700;color:#7ec8e3;white-space:nowrap}
      .bcm-id{font-family:monospace;font-size:.73rem;color:#666}
      .bcm-cargo-id{font-family:monospace;font-size:.73rem;color:#e09050}
      .bcm-task{font-size:.74rem;color:#888;max-width:240px}
      .bcm-async{color:#444;font-size:.75rem}
      .bcm-yes{color:#4caf50;font-weight:700}
      .bcm-no{color:#444}
      .bcm-na{color:#555;font-size:.7rem;font-style:italic}
      .bcm-price{color:#aaa;font-size:.7rem;margin-left:3px}
      .bcm-names{color:#7ec8e3;font-size:.73rem}
      .bcm-trd-qty{color:#555;font-size:.68rem}
      .bcm-inv-full{color:#4caf50;font-size:.73rem}
      .bcm-inv-partial{color:#e0a030;font-size:.73rem}
    `;

    const expiryStr = expiry
      ? ` · Resets ${new Date(expiry * 1000).toLocaleString()}`
      : '';

    const loadingHtml = `
      <div id="bcm-overlay">
        <style>${css}</style>
        <div id="bcm-modal">
          <h2>⚙ Bitcraft Coin Minter — Traveler Tasks</h2>
          <div id="bcm-meta">Loading…</div>
          <div id="bcm-btns">
            <button id="bcm-close">✕ Close</button>
            <span id="bcm-status">Fetching task data…</span>
          </div>
          <div id="bcm-tbl-wrap"></div>
        </div>
      </div>`;

    const div = document.createElement('div');
    div.id = 'bcm-overlay';
    div.innerHTML = `<style>${css}</style><div id="bcm-modal">
      <h2>⚙ Bitcraft Coin Minter — Traveler Tasks</h2>
      <div id="bcm-meta">${rows ? `${rowCount} item${rowCount !== 1 ? 's' : ''} · ${citizenCount} claim citizens${expiryStr}` : 'Loading…'}</div>
      <div id="bcm-btns">
        <button id="bcm-close">✕ Close</button>
        ${rows ? `<button id="bcm-copy">⎘ Copy TSV</button><button id="bcm-csv">↓ Download CSV</button><button id="bcm-clr">⌫ Clear Claim ID</button>` : ''}
        <span id="bcm-status">${rows ? '' : 'Fetching task data…'}</span>
      </div>
      <div id="bcm-tbl-wrap">${rows ? buildTable(rows) : ''}</div>
    </div>`;

    document.body.appendChild(div);

    document.getElementById('bcm-close').onclick = () => div.remove();
    div.onclick = e => { if (e.target === div) div.remove(); };

    const copyBtn = document.getElementById('bcm-copy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(toTSV(rows)).then(() => {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = '⎘ Copy TSV'; }, 2000);
        });
      };
    }

    const csvBtn = document.getElementById('bcm-csv');
    if (csvBtn) {
      csvBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(toCSV(rows));
        a.download = 'traveler-tasks.csv';
        a.click();
      };
    }

    const clrBtn = document.getElementById('bcm-clr');
    if (clrBtn) {
      clrBtn.onclick = () => {
        localStorage.removeItem('bcm_claim_id');
        clrBtn.textContent = '✓ Cleared';
        clrBtn.disabled = true;
        setTimeout(() => { clrBtn.textContent = '⌫ Clear Claim ID'; clrBtn.disabled = false; }, 2000);
      };
    }
  }

  function buildTable(rows) {
    const thead = `<tr>
      <th>Traveler</th><th>Item</th><th>Qty</th><th>Rarity</th><th>ID</th>
      <th title="Your own inventory locations holding this item (green = enough, orange = partial)">In My Inventory</th>
      <th title="Claim citizens with a Trader Stand stocked with enough qty">In Stock (Traders)</th>
      <th title="Item listed on claim market · global lowest price">On Market ⓘ</th>
      <th>Task</th>
    </tr>`;
    const tbody = rows.map((r, i) => {
      const idClass = r.type === 'cargo' ? 'bcm-cargo-id' : 'bcm-id';
      const idLabel = (r.type === 'cargo' ? 'cargo:' : '') + r.id;
      return `<tr>
        <td>${escHtml(r.traveler)}</td>
        <td>${escHtml(r.item)}</td>
        <td class="bcm-qty">${r.qty.toLocaleString()}</td>
        <td>${escHtml(r.rarity)}</td>
        <td class="${idClass}">${idLabel}</td>
        <td id="bcm-inv-${i}" class="bcm-async">⏳</td>
        <td id="bcm-trd-${i}" class="bcm-async">⏳</td>
        <td id="bcm-mkt-${i}" class="bcm-async">⏳</td>
        <td class="bcm-task">${escHtml(r.task)}</td>
      </tr>`;
    }).join('');
    return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }

  // ── Export helpers ────────────────────────────────────────────────────────────
  function cellText(rowIndex, colId) {
    const el = document.getElementById(`${colId}-${rowIndex}`);
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
  }

  function toTSV(rows) {
    const header = 'Traveler\tItem\tQty\tRarity\tID\tIn My Inventory\tIn Stock (Traders)\tOn Market\tTask';
    const lines = rows.map((r, i) => [
      r.traveler, r.item, r.qty, r.rarity,
      (r.type === 'cargo' ? 'cargo:' : '') + r.id,
      cellText(i, 'bcm-inv'), cellText(i, 'bcm-trd'), cellText(i, 'bcm-mkt'),
      r.task
    ].join('\t'));
    return [header, ...lines].join('\n');
  }

  function toCSV(rows) {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const header = 'Traveler,Item,Qty,Rarity,ID,In My Inventory,In Stock (Traders),On Market,Task';
    const lines = rows.map((r, i) => [
      q(r.traveler), q(r.item), r.qty, q(r.rarity),
      q((r.type === 'cargo' ? 'cargo:' : '') + r.id),
      q(cellText(i, 'bcm-inv')), q(cellText(i, 'bcm-trd')), q(cellText(i, 'bcm-mkt')),
      q(r.task)
    ].join(','));
    return [header, ...lines].join('\n');
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────
  function apiFetch(url, headers) {
    return fetch(url, { headers }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json();
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('bcm-status');
    if (el) el.textContent = msg;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
