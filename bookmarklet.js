(function () {
  'use strict';
  const HEADERS     = { 'x-app-identifier': 'BitcraftCoinMinter' };
  const REFRESH_MS  = 5 * 60 * 1000; // auto-refresh every 5 min
  const HEX         = '⬡';

  // ── CSS (must be declared before first use in inject()) ───────────────────────
  const CSS = `
    #bcm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}
    #bcm-modal{background:#12121e;color:#ddd;border-radius:12px;padding:24px;max-width:98vw;width:1200px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(0,0,0,.9)}
    #bcm-hdr-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
    #bcm-modal h2{margin:0;font-size:1.1rem;color:#f0a500}
    #bcm-cd{font-size:.85rem;font-weight:600}
    .bcm-cd{color:#7ec8e3}
    .bcm-cd-urgent{color:#e05050;animation:bcm-pulse 1s infinite}
    @keyframes bcm-pulse{0%,100%{opacity:1}50%{opacity:.4}}
    #bcm-meta{font-size:.72rem;color:#555;margin-bottom:10px}
    #bcm-btns{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
    #bcm-btns button{padding:4px 12px;border:none;border-radius:5px;cursor:pointer;font-size:.75rem;font-weight:600;transition:opacity .15s}
    #bcm-btns button:hover{opacity:.8}
    #bcm-close{background:#8b1a1a;color:#fff}
    #bcm-refresh-btn{background:#1a3a5c;color:#fff}
    #bcm-copy,#bcm-csv{background:#1a5c35;color:#fff}
    #bcm-clr{background:#252525;color:#666;font-weight:400}
    #bcm-filter-btn{background:#252535;color:#999;font-weight:400}
    #bcm-filter-btn.bcm-active{background:#1a4a1a;color:#7cfc00;font-weight:600}
    #bcm-status{font-size:.72rem;color:#777;margin-left:2px}
    #bcm-refresh-in{font-size:.7rem;color:#3a3a55;margin-left:auto;font-variant-numeric:tabular-nums}
    #bcm-tbl-wrap{overflow:auto;flex:1;min-height:0}
    #bcm-tbl{border-collapse:collapse;width:100%;font-size:.78rem;min-width:900px}
    #bcm-tbl thead th{background:#1a1a30;color:#f0a500;padding:7px 10px;text-align:left;position:sticky;top:0;z-index:2;white-space:nowrap;border-bottom:2px solid #2a2a50}
    th.bcm-sortable{cursor:pointer;user-select:none}
    th.bcm-sortable:hover{background:#22224a;color:#ffc030}
    #bcm-tbl td{padding:6px 10px;vertical-align:top;border-bottom:1px solid #191928}
    tr.bcm-task-row{border-bottom:2px solid #28284a}
    tr.bcm-task-row:hover td{background:#161624}
    .bcm-traveler{font-weight:700;color:#f0a500;white-space:nowrap;padding-right:6px;vertical-align:top}
    .bcm-items{color:#ccc;line-height:1.7}
    .bcm-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .bcm-qty{color:#7ec8e3;font-weight:700}
    .bcm-sub{color:#3a3a55;font-size:.68rem}
    .bcm-ok{color:#4caf50;font-weight:600}
    .bcm-pos{color:#4caf50;font-weight:700}
    .bcm-neg{color:#e05050;font-weight:700}
    .bcm-na{color:#333;font-style:italic;font-size:.7rem}
    .bcm-dim{color:#383850;font-size:.72rem}
    .bcm-blue{color:#7ec8e3;font-size:.72rem}
    .bcm-inv-ok{color:#4caf50;font-size:.72rem}
    .bcm-inv-part{color:#e0a030;font-size:.72rem}
    .bcm-col-inv{max-width:160px;line-height:1.7}
    .bcm-col-trd{max-width:260px;line-height:1.7}
    .bcm-col-price{line-height:1.7;white-space:nowrap}
    .bcm-col-craft{line-height:1.7;white-space:nowrap}
  `;

  // ── Global state ──────────────────────────────────────────────────────────────
  const G = {
    tasks: [],
    sortCol: 'profit', sortAsc: false,
    expiry: null, citizenCount: 0,
    playerId: null, claimId: null,
    marketDone: false, tradersDone: false, craftDone: false,
    countdownTimer: null, refreshTimer: null, refreshCountdownTimer: null,
    refreshAt: null, loading: false,
    filterCompletable: false,
  };

  // ── Entry ─────────────────────────────────────────────────────────────────────
  let claimId = localStorage.getItem('bcm_claim_id');
  if (!claimId) {
    claimId = prompt('Enter your Claim Entity ID\n(from your Bitjita claim URL, e.g. /claims/864691128472806646):');
    if (!claimId) return;
    claimId = claimId.trim();
    localStorage.setItem('bcm_claim_id', claimId);
  }
  const urlMatch = location.pathname.match(/\/players\/(\d+)/);
  const playerId = urlMatch?.[1] ?? prompt('Enter your Player Entity ID\n(from your Bitjita profile URL):');
  if (!playerId) return;

  G.claimId = claimId;
  G.playerId = playerId;
  document.getElementById('bcm-overlay')?.remove();
  showLoadingModal();
  startRun();

  // ── Main run ──────────────────────────────────────────────────────────────────
  async function startRun() {
    if (G.loading) return;
    G.loading = true;
    G.marketDone = false; G.tradersDone = false; G.craftDone = false;
    setStatus('Fetching task data…');

    try {
      const [tasksData, citizensData, myInvData] = await Promise.all([
        apiFetch(`/api/players/${G.playerId}/traveler-tasks`),
        apiFetch(`/api/claims/${G.claimId}/citizens`),
        apiFetch(`/api/players/${G.playerId}/inventories`),
      ]);

      G.expiry       = tasksData.expirationTimestamp;
      G.citizenCount = citizensData.citizens?.length ?? 0;
      G.tasks        = buildTasks(tasksData, myInvData);

      if (!G.tasks.length) { setStatus('No incomplete tasks found.'); G.loading = false; return; }

      showTableModal();
      scheduleRefresh();
      G.loading = false;
      setStatus('Loading market prices…');

      await Promise.all([
        enrichMarket(),
        enrichTraders(citizensData),
        enrichCrafting(myInvData),
      ]);
      setStatus('');
    } catch (err) {
      setStatus(`⚠ Failed: ${err.message}`);
      G.loading = false;
    }
  }

  // ── Build task objects ────────────────────────────────────────────────────────
  function buildTasks(tasksData, myInvData) {
    const invMap = buildInvMap(myInvData);
    const tasks  = [];
    let tIdx = 0;

    for (const task of (tasksData.tasks || [])) {
      if (task.completed) continue;
      const traveler = (task.description || '').split(' ')[0] || '?';
      const reward   = (task.rewardedItems || []).find(r => r.item_id === 1)?.quantity ?? 0;
      const items    = [];
      let iIdx = 0;

      for (const req of (task.requiredItems || [])) {
        const isCargo = req.item_type === 'cargo';
        const info    = (isCargo ? tasksData.cargo : tasksData.items)?.[req.item_id] ?? {};
        items.push({
          taskIdx: tIdx, itemIdx: iIdx,
          name:    info.name || String(req.item_id),
          qty:     req.quantity,
          id:      String(req.item_id),
          type:    req.item_type,
          rarity:  info.rarityStr || '',
          invSlots:    invMap[String(req.item_id)] || [],
          traderSlots: null,   // null = loading
          price:       null,   // null = loading; false = not listed
          craftInfo:   null,   // null = loading
        });
        iIdx++;
      }
      if (!items.length) continue;
      tasks.push({ idx: tIdx, traveler, description: task.description || '', reward, items, totalCost: null, profit: null });
      tIdx++;
    }
    return tasks;
  }

  function buildInvMap(myInvData) {
    const map = {};
    for (const inv of (myInvData?.inventories || [])) {
      const loc = inv.inventoryName || 'Unknown';
      for (const pocket of (inv.pockets || [])) {
        const c = pocket.contents; if (!c) continue;
        const k = String(c.itemId);
        if (!map[k]) map[k] = [];
        map[k].push({ loc, qty: c.quantity });
      }
    }
    return map;
  }

  // ── Market enrichment — /api/market/item/[id]?claimEntityId=... ───────────────
  async function enrichMarket() {
    const uniqueIds = [...new Set(
      G.tasks.flatMap(t => t.items.filter(i => i.type !== 'cargo').map(i => i.id))
    )];

    const priceMap = {};
    await Promise.all(uniqueIds.map(async id => {
      const d = await apiFetch(`/api/market/item/${id}?claimEntityId=${G.claimId}`).catch(() => null);
      // stats.lowestSell is null when no sell orders exist at this claim
      priceMap[id] = d?.stats?.lowestSell ?? false; // false = "not listed"
    }));

    for (const task of G.tasks) {
      let totalCost = 0, allKnown = true;
      for (const item of task.items) {
        if (item.type === 'cargo') { item.price = false; continue; }
        item.price = priceMap[item.id] ?? false;
        if (item.price === false) { allKnown = false; totalCost = null; }
        else if (totalCost != null) totalCost += item.price * item.qty;
      }
      const allCargo = task.items.every(i => i.type === 'cargo');
      task.totalCost = allCargo ? null : (allKnown ? totalCost : null);
      task.profit    = task.totalCost != null ? task.reward - task.totalCost
                     : allCargo               ? task.reward
                     :                          null;
    }
    G.marketDone = true;
    renderTable();
  }

  // ── Trader enrichment — citizen Trader Stand inventories ─────────────────────
  async function enrichTraders(citizensData) {
    const citizens = citizensData.citizens || [];
    setStatus(`Fetching ${citizens.length} trader inventories…`);

    const results = await Promise.all(
      citizens.map(c => apiFetch(`/api/players/${c.entityId}/inventories`).catch(() => null))
    );
    const map = {};
    citizens.forEach((citizen, i) => {
      const inv = results[i]; if (!inv) return;
      for (const bag of (inv.inventories || []).filter(x => x.inventoryName?.includes('Trader Stand'))) {
        for (const pocket of (bag.pockets || [])) {
          const c = pocket.contents; if (!c) continue;
          const k = String(c.itemId);
          if (!map[k]) map[k] = [];
          map[k].push({ name: citizen.userName, qty: c.quantity });
        }
      }
    });

    for (const task of G.tasks)
      for (const item of task.items)
        item.traderSlots = (map[item.id] || []).filter(e => e.qty >= item.qty);

    G.tradersDone = true;
    renderTable();
    if (!G.craftDone) setStatus('Loading crafting data…');
  }

  // ── Crafting enrichment — consumedItemStacks / craftedItemStacks ──────────────
  async function enrichCrafting(myInvData) {
    const invMap = buildInvMap(myInvData);

    // Deduplicate by id+type
    const seen = new Map();
    const uniqueItems = G.tasks.flatMap(t => t.items).filter(item => {
      const k = item.id + '|' + item.type;
      if (seen.has(k)) return false;
      seen.set(k, true);
      return true;
    });

    const craftMap = {};
    await Promise.all(uniqueItems.map(async item => {
      const k   = item.id + '|' + item.type;
      // Cargo items generally don't have crafting recipes; skip to save API calls
      if (item.type === 'cargo') { craftMap[k] = { status: 'none' }; return; }
      const d   = await apiFetch(`/api/items/${item.id}`).catch(() => null);
      const recipes = d?.craftingRecipes || [];
      if (!recipes.length) { craftMap[k] = { status: 'none' }; return; }

      // Use first recipe that produces this item
      const recipe = recipes.find(r => r.craftedItemStacks?.some(o => String(o.item_id) === item.id)) ?? recipes[0];
      const inputs  = recipe.consumedItemStacks || [];
      const outQty  = recipe.craftedItemStacks?.find(o => String(o.item_id) === item.id)?.quantity
                   ?? recipe.outputQuantity ?? 1;
      const runs    = Math.ceil(item.qty / outQty);

      if (!inputs.length) { craftMap[k] = { status: 'none' }; return; }

      let allOk = true, anyOk = false;
      const details = [];
      for (const inp of inputs) {
        const ingId  = String(inp.item_id);
        const ingQty = (inp.quantity ?? 1) * runs;
        const have   = (invMap[ingId] || []).reduce((s, e) => s + e.qty, 0);
        if (have >= ingQty) anyOk = true; else allOk = false;
        details.push({ id: ingId, name: inp.name || ingId, need: ingQty, have });
      }
      craftMap[k] = {
        status:  allOk ? 'yes' : anyOk ? 'partial' : 'no',
        details,
        building: recipe.buildingName || '',
      };
    }));

    // Write results back (also propagate to duplicate items in other tasks)
    for (const task of G.tasks)
      for (const item of task.items)
        item.craftInfo = craftMap[item.id + '|' + item.type] ?? { status: 'none' };

    G.craftDone = true;
    renderTable();
    setStatus('');
  }

  // ── Render table ──────────────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('bcm-tbody');
    if (!tbody) return;

    const sorted = [...G.tasks].sort((a, b) => {
      let va = sortVal(a), vb = sortVal(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return G.sortAsc ? cmp : -cmp;
    });

    const display = G.filterCompletable ? sorted.filter(isCompletable) : sorted;
    tbody.innerHTML = display.map(task => renderTask(task)).join('');

    const meta = document.getElementById('bcm-meta');
    if (meta) {
      const total = G.tasks.length;
      const shown = display.length;
      meta.textContent = G.filterCompletable
        ? `${shown} of ${total} task${total !== 1 ? 's' : ''} (completable only) · ${G.citizenCount} citizens`
        : `${total} task${total !== 1 ? 's' : ''} · ${G.citizenCount} citizens`;
    }
  }

  function sortVal(task) {
    switch (G.sortCol) {
      case 'traveler':  return task.traveler;
      case 'reward':    return task.reward;
      case 'totalCost': return task.totalCost;
      case 'profit':    return task.profit;
      default:          return null;
    }
  }

  // A task is completable if every item has at least one obtainable source
  function isCompletable(task) {
    return task.items.every(item => {
      if ((item.invSlots || []).reduce((s, e) => s + e.qty, 0) >= item.qty) return true; // in inventory
      if (item.price)                           return true;   // on market at claim
      if ((item.traderSlots || []).length > 0)  return true;   // trader has stock
      if (item.craftInfo?.status === 'yes')     return true;   // fully craftable
      return false;
    });
  }

  function renderTask(task) {
    const allCargo  = task.items.every(i => i.type === 'cargo');
    const costStr   = task.totalCost != null  ? `${HEX} ${fmt(task.totalCost)}`
                    : G.marketDone && allCargo ? '—'
                    : G.marketDone            ? `${HEX} ?`
                    :                           '⏳';
    const profitStr = task.profit != null     ? `${HEX} ${fmt(task.profit)}`
                    : G.marketDone && allCargo ? '—'
                    : G.marketDone            ? `${HEX} ?`
                    :                           '⏳';
    const profitCls = task.profit == null ? '' : task.profit >= 0 ? ' bcm-pos' : ' bcm-neg';

    const itemsHtml = task.items.map(i =>
      `<span class="bcm-qty">${fmt(i.qty)}×</span> ${escHtml(i.name)}`
    ).join('<br>');

    const invHtml = task.items.map(item => {
      const slots = item.invSlots || [];
      const total = slots.reduce((s, e) => s + e.qty, 0);
      if (!slots.length) return `<span class="bcm-dim">—</span>`;
      const cls = total >= item.qty ? 'bcm-inv-ok' : 'bcm-inv-part';
      const tip = `${total.toLocaleString()} / ${item.qty.toLocaleString()} needed`;
      return `<span class="${cls}" title="${escHtml(tip)}">${slots.map(e => `${escHtml(e.loc)} <span class="bcm-sub">(${e.qty.toLocaleString()})</span>`).join(', ')}</span>`;
    }).join('<br>');

    const trdHtml = task.items.map(item => {
      if (item.traderSlots == null && !G.tradersDone) return '⏳';
      if (!(item.traderSlots || []).length) return `<span class="bcm-dim">—</span>`;
      const shown = item.traderSlots.slice(0, 3);
      const extra = item.traderSlots.length - 3;
      const names = shown.map(e => `${escHtml(e.name)} <span class="bcm-sub">(${e.qty.toLocaleString()})</span>`).join(', ');
      const more  = extra > 0 ? ` <span class="bcm-sub">+${extra} more</span>` : '';
      return `<span class="bcm-blue">${names}${more}</span>`;
    }).join('<br>');

    const priceHtml = task.items.map(item => {
      if (item.type === 'cargo') return `<span class="bcm-na">—</span>`;
      if (item.price == null && !G.marketDone) return '⏳';
      if (!item.price) return `<span class="bcm-dim">not listed</span>`;
      return `${HEX} ${fmt(item.price)} <span class="bcm-sub">(${HEX} ${fmt(item.price * item.qty)})</span>`;
    }).join('<br>');

    const craftHtml = task.items.map(item => {
      if (item.craftInfo == null && !G.craftDone) return '⏳';
      const ci  = item.craftInfo ?? { status: 'none' };
      const tip = ci.details?.map(d => `${d.name}: ${d.have.toLocaleString()} / ${d.need.toLocaleString()}`).join('\n') || '';
      const bld = ci.building ? ` <span class="bcm-sub">(${escHtml(ci.building)})</span>` : '';
      return ci.status === 'none'    ? `<span class="bcm-na">—</span>`
        : ci.status === 'yes'        ? `<span class="bcm-ok" title="${escHtml(tip)}">✓${bld}</span>`
        : ci.status === 'partial'    ? `<span class="bcm-inv-part" title="${escHtml(tip)}">~${bld}</span>`
        :                              `<span class="bcm-dim" title="${escHtml(tip)}">✗${bld}</span>`;
    }).join('<br>');

    return `<tr class="bcm-task-row">
      <td class="bcm-traveler">${escHtml(task.traveler)}</td>
      <td class="bcm-items">${itemsHtml}</td>
      <td class="bcm-col-inv">${invHtml}</td>
      <td class="bcm-col-trd">${trdHtml}</td>
      <td class="bcm-col-price">${priceHtml}</td>
      <td class="bcm-col-craft">${craftHtml}</td>
      <td class="bcm-num">${HEX} ${fmt(task.reward)}</td>
      <td class="bcm-num">${costStr}</td>
      <td class="bcm-num${profitCls}">${profitStr}</td>
    </tr>`;
  }

  // ── Modal: loading ────────────────────────────────────────────────────────────
  function showLoadingModal() {
    document.getElementById('bcm-overlay')?.remove();
    inject(`<div id="bcm-modal">
      <h2>⚙ Bitcraft Coin Minter</h2>
      <div id="bcm-meta">Loading…</div>
      <div id="bcm-btns">
        <button id="bcm-close">✕ Close</button>
        <span id="bcm-status">Fetching data…</span>
      </div>
    </div>`);
  }

  // ── Modal: table ──────────────────────────────────────────────────────────────
  function showTableModal() {
    document.getElementById('bcm-overlay')?.remove();

    // 9 columns: Traveler | Items | My Inventory | Traders | Price | Craftable | Reward | Cost | Profit
    const COLS = [
      { label: 'Traveler',       sort: 'traveler'  },
      { label: 'Items',          sort: null         },
      { label: 'My Inventory',   sort: null         },
      { label: 'Traders',        sort: null         },
      { label: `Price ${HEX}`,   sort: null         },
      { label: 'Craftable',      sort: null         },
      { label: `Reward ${HEX}`,  sort: 'reward'     },
      { label: `Cost ${HEX}`,    sort: 'totalCost'  },
      { label: `Profit ${HEX}`,  sort: 'profit'     },
    ];

    const thHtml = COLS.map(c => {
      const active = c.sort && c.sort === G.sortCol;
      const ind    = active ? (G.sortAsc ? ' ↑' : ' ↓') : '';
      return `<th${c.sort ? ` class="bcm-sortable" data-sort="${c.sort}"` : ''}>${escHtml(c.label + ind)}</th>`;
    }).join('');

    inject(`<div id="bcm-modal">
      <div id="bcm-hdr-row">
        <h2>⚙ Bitcraft Coin Minter — Traveler Tasks</h2>
        <div id="bcm-cd"></div>
      </div>
      <div id="bcm-meta">${G.tasks.length} task${G.tasks.length !== 1 ? 's' : ''} · ${G.citizenCount} citizens</div>
      <div id="bcm-btns">
        <button id="bcm-close">✕ Close</button>
        <button id="bcm-refresh-btn">↺ Refresh</button>
        <button id="bcm-filter-btn">☑ Completable</button>
        <button id="bcm-copy">⎘ TSV</button>
        <button id="bcm-csv">↓ CSV</button>
        <button id="bcm-clr">⌫ Claim ID</button>
        <span id="bcm-status"></span>
        <span id="bcm-refresh-in"></span>
      </div>
      <div id="bcm-tbl-wrap">
        <table id="bcm-tbl">
          <thead><tr>${thHtml}</tr></thead>
          <tbody id="bcm-tbody"></tbody>
        </table>
      </div>
    </div>`);

    // Sort click handlers
    document.querySelectorAll('#bcm-tbl th.bcm-sortable').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        G.sortAsc = G.sortCol === col ? !G.sortAsc : false;
        G.sortCol = col;
        document.querySelectorAll('#bcm-tbl th.bcm-sortable').forEach(h => {
          const c   = COLS.find(x => x.sort === h.dataset.sort);
          const act = h.dataset.sort === G.sortCol;
          h.textContent = (c?.label || '') + (act ? (G.sortAsc ? ' ↑' : ' ↓') : '');
        });
        renderTable();
      };
    });

    const ov = document.getElementById('bcm-overlay');
    document.getElementById('bcm-close').onclick       = () => closeModal();
    ov.onclick = e => { if (e.target === ov) closeModal(); };
    document.getElementById('bcm-refresh-btn').onclick  = () => { clearTimers(); showLoadingModal(); startRun(); };
    const filterBtn = document.getElementById('bcm-filter-btn');
    if (G.filterCompletable) filterBtn.classList.add('bcm-active');
    filterBtn.onclick = () => {
      G.filterCompletable = !G.filterCompletable;
      filterBtn.classList.toggle('bcm-active', G.filterCompletable);
      renderTable();
    };
    document.getElementById('bcm-copy').onclick = () => {
      const btn = document.getElementById('bcm-copy');
      navigator.clipboard.writeText(toTSV()).then(() => {
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '⎘ TSV'; }, 2000);
      });
    };
    document.getElementById('bcm-csv').onclick = () => {
      const a = document.createElement('a');
      a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(toCSV());
      a.download = 'traveler-tasks.csv';
      a.click();
    };
    document.getElementById('bcm-clr').onclick = () => {
      localStorage.removeItem('bcm_claim_id');
      const b = document.getElementById('bcm-clr');
      b.textContent = '✓ Cleared'; b.disabled = true;
    };

    renderTable();
    startCountdown();
    startRefreshCountdown();
  }

  // ── Timers ────────────────────────────────────────────────────────────────────
  function inject(inner) {
    const div    = document.createElement('div');
    div.id       = 'bcm-overlay';
    div.innerHTML = `<style>${CSS}</style>${inner}`;
    document.body.appendChild(div);
  }

  function closeModal()  { clearTimers(); document.getElementById('bcm-overlay')?.remove(); }

  function clearTimers() {
    clearInterval(G.countdownTimer);
    clearTimeout(G.refreshTimer);
    clearInterval(G.refreshCountdownTimer);
    G.countdownTimer = G.refreshTimer = G.refreshCountdownTimer = null;
  }

  function startCountdown() {
    if (!G.expiry) return;
    const tick = () => {
      const el = document.getElementById('bcm-cd');
      if (!el) { clearInterval(G.countdownTimer); return; }
      const ms = G.expiry * 1000 - Date.now();
      if (ms <= 0) { el.textContent = '⏰ Reset overdue'; el.className = 'bcm-cd-urgent'; return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      el.textContent = `⏱ ${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s until reset`;
      el.className   = h < 1 ? 'bcm-cd-urgent' : 'bcm-cd';
    };
    tick();
    G.countdownTimer = setInterval(tick, 1000);
  }

  function scheduleRefresh() {
    G.refreshAt   = Date.now() + REFRESH_MS;
    G.refreshTimer = setTimeout(() => {
      if (!document.getElementById('bcm-overlay')) return;
      clearTimers(); showLoadingModal(); startRun();
    }, REFRESH_MS);
  }

  function startRefreshCountdown() {
    const tick = () => {
      const el = document.getElementById('bcm-refresh-in');
      if (!el || !G.refreshAt) return;
      const ms = G.refreshAt - Date.now();
      if (ms <= 0) { el.textContent = ''; return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      el.textContent = `↺ ${m}:${String(s).padStart(2,'0')}`;
    };
    tick();
    G.refreshCountdownTimer = setInterval(tick, 1000);
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  function toTSV() {
    const rows = [['Traveler','Task','Reward','Cost','Profit','Item','Qty','Rarity','ID','My Inventory','Traders','Unit Price','Total Price','Craftable'].join('\t')];
    for (const t of G.tasks) {
      for (const i of t.items) {
        rows.push([
          t.traveler, t.description, t.reward, t.totalCost ?? '', t.profit ?? '',
          i.name, i.qty, i.rarity, (i.type === 'cargo' ? 'cargo:' : '') + i.id,
          (i.invSlots || []).map(e => `${e.loc}(${e.qty})`).join('; ') || '—',
          (i.traderSlots || []).map(e => `${e.name}(${e.qty})`).join('; ') || '—',
          i.price || '',
          i.price ? i.price * i.qty : '',
          i.craftInfo ? ({ none:'—', yes:'✓', partial:'~', no:'✗' }[i.craftInfo.status] || '') : '',
        ].join('\t'));
      }
    }
    return rows.join('\n');
  }

  function toCSV() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return toTSV().split('\n').map(row => row.split('\t').map(q).join(',')).join('\n');
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────
  function setStatus(msg) { const el = document.getElementById('bcm-status'); if (el) el.textContent = msg; }
  function fmt(n)          { return Number(n).toLocaleString(); }
  function apiFetch(url)   { return fetch(url, { headers: HEADERS }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }); }
  function escHtml(s)      { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

})();
