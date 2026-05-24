// Admin dashboard — REST API calls + WebSocket for live updates
(() => {
  const DENOMS = [20, 50, 100, 500, 1000];
  let currentCoins = 0;   // cache จาก /api/state สำหรับใช้ใน preview +/-

  const els = {
    stateBadge:   document.getElementById('state-badge'),
    username:     document.getElementById('username'),
    coinCount:    document.getElementById('coin-count'),
    threshold:    document.getElementById('threshold'),
    billsTotal:   document.getElementById('bills-total'),
    coinsDispensed: document.getElementById('coins-dispensed'),
    coinsExpected:  document.getElementById('coins-expected'),
    esp32Dot:     document.getElementById('esp32-dot'),
    esp32Text:    document.getElementById('esp32-text'),
    errorBanner:  document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-message'),
    inhibitToggles: document.getElementById('inhibit-toggles'),
    thresholdInput: document.getElementById('threshold-input'),
    disableBtnText: document.getElementById('disable-btn-text'),
    txBody:       document.getElementById('transactions-body'),
    evBody:       document.getElementById('events-body'),
    coinCustom:   document.getElementById('coin-custom'),
    coinPreview:  document.getElementById('coin-preview'),
    coinAddBtn:      document.getElementById('coin-add-btn'),
    coinSubtractBtn: document.getElementById('coin-subtract-btn'),
    testCoins:    document.getElementById('test-coins'),
  };

  // pendingOp: 'add' | 'subtract' — เลือก sign ก่อนกดยืนยัน (default 'add')
  let pendingOp = 'add';

  // ===== Helpers =====
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      location.href = '/admin/login';
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function notify(msg, ok = true) {
    // ง่ายๆ ก่อน ใช้ alert — อนาคตทำ toast
    if (!ok) alert('⚠️ ' + msg);
  }

  // ===== Render =====
  function renderState(s) {
    els.stateBadge.textContent = s.state;
    els.stateBadge.className = `state-badge state-${s.state} ml-3`;

    currentCoins = Number(s.coinCount) || 0;
    els.coinCount.textContent  = s.coinCount;
    if (els.coinPreview) updateCoinPreview();
    els.threshold.textContent  = s.lowCoinThreshold;
    els.billsTotal.textContent = s.billsTotal ?? 0;
    els.coinsDispensed.textContent = s.coinsDispensed ?? 0;
    els.coinsExpected.textContent  = s.coinsExpected ?? 0;

    els.esp32Dot.className = `w-3 h-3 rounded-full ${s.esp32Connected ? 'bg-green-500' : 'bg-red-500'}`;
    els.esp32Text.textContent = s.esp32Connected ? 'connected' : 'disconnected';

    if (s.state === 'error' && s.error) {
      els.errorBanner.classList.remove('hidden');
      els.errorMessage.textContent = s.error;
    } else {
      els.errorBanner.classList.add('hidden');
    }

    // Disable button label
    if (s.machineDisabled || s.state === 'disabled') {
      els.disableBtnText.textContent = '▶ เปิดเครื่อง';
      document.getElementById('disable-btn').dataset.disabled = '1';
    } else {
      els.disableBtnText.textContent = '⏸ ปิดเครื่องชั่วคราว';
      document.getElementById('disable-btn').dataset.disabled = '0';
    }
  }

  function renderInhibits(inhibits) {
    els.inhibitToggles.innerHTML = '';
    for (const d of DENOMS) {
      // inhibits[d] === true หมายถึง ปิดรับ → accepting = false
      const accepting = !inhibits?.[d];
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between bg-slate-900/40 hover:bg-slate-900/70 active:bg-slate-900 rounded-lg px-4 py-3 min-h-[44px] cursor-pointer select-none transition-colors';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `${accepting ? 'ปิด' : 'เปิด'}รับธนบัตร ${d} บาท`);
      row.innerHTML = `
        <div class="flex items-center gap-3 pointer-events-none">
          <span class="font-num text-xl font-bold w-14">${d}</span>
          <span class="text-xs text-slate-400">บาท</span>
        </div>
        <div class="flex items-center gap-3 pointer-events-none">
          <span class="text-sm font-medium ${accepting ? 'text-green-400' : 'text-red-400'}">
            ${accepting ? 'เปิดรับ' : 'ปิดรับ'}
          </span>
          <div
            role="switch"
            aria-checked="${accepting}"
            class="relative w-16 h-9 rounded-full transition-colors ${accepting ? 'bg-green-600' : 'bg-red-600'}">
            <span class="absolute top-1 w-7 h-7 bg-white rounded-full shadow transition-all ${accepting ? 'left-8' : 'left-1'}"></span>
          </div>
        </div>
      `;
      // ทั้งแถวคลิกได้ → tap target ใหญ่ทั้ง row (มือถือสบาย)
      const toggle = () => toggleInhibit(d, accepting);
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      els.inhibitToggles.appendChild(row);
    }
  }

  function renderTransactions(rows) {
    if (!rows.length) {
      els.txBody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-slate-500">ยังไม่มี transaction</td></tr>';
      return;
    }
    els.txBody.innerHTML = rows.map(t => `
      <tr class="border-b border-slate-700/50">
        <td class="py-2 px-2 text-slate-300">${fmtTime(t.started_at)}</td>
        <td class="py-2 px-2 text-right">${t.bills_total}</td>
        <td class="py-2 px-2 text-right">${t.coins_dispensed}/${t.coins_expected}</td>
        <td class="py-2 px-2"><span class="text-xs px-2 py-0.5 rounded ${statusColor(t.status)}">${t.status}</span></td>
        <td class="py-2 px-2 text-red-400 text-xs">${t.error || ''}</td>
      </tr>
    `).join('');
  }

  function renderEvents(rows) {
    if (!rows.length) {
      els.evBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-slate-500">ยังไม่มี event</td></tr>';
      return;
    }
    els.evBody.innerHTML = rows.map(e => {
      const data = e.data ? `<span class="text-slate-500"> ${escapeHtml(e.data)}</span>` : '';
      return `
        <tr class="border-b border-slate-700/30">
          <td class="py-1 px-2 text-slate-400">${fmtTime(e.ts)}</td>
          <td class="py-1 px-2"><span class="${levelColor(e.level)}">${e.level}</span></td>
          <td class="py-1 px-2 text-slate-400">${e.source}</td>
          <td class="py-1 px-2 text-slate-300">${escapeHtml(e.message)}${data}</td>
        </tr>
      `;
    }).join('');
  }

  function statusColor(s) {
    switch (s) {
      case 'completed':            return 'bg-green-900 text-green-300';
      case 'jammed':               return 'bg-red-900 text-red-300';
      case 'aborted':              return 'bg-yellow-900 text-yellow-300';
      case 'power_loss_recovered': return 'bg-purple-900 text-purple-300';
      default:                     return 'bg-slate-700 text-slate-300';
    }
  }
  function levelColor(l) {
    if (l === 'error') return 'text-red-400 font-bold';
    if (l === 'warn')  return 'text-yellow-400';
    return 'text-slate-400';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  // ===== Actions =====

  async function refreshState() {
    try {
      const s = await api('/admin/api/state');
      if (!s) return;
      els.username.textContent = s.admin?.username || '—';
      els.thresholdInput.value = s.lowCoinThreshold;
      renderState(s);
      renderInhibits(s.inhibits);
    } catch (e) { notify(e.message, false); }
  }

  async function refreshTransactions() {
    try {
      const { transactions } = await api('/admin/api/transactions?limit=20');
      renderTransactions(transactions);
    } catch (e) { notify(e.message, false); }
  }

  async function refreshEvents() {
    try {
      const { events } = await api('/admin/api/events?limit=100');
      renderEvents(events);
    } catch (e) { notify(e.message, false); }
  }

  async function addCoins(delta) {
    try { await api('/admin/api/coins', { method: 'POST', body: JSON.stringify({ delta }) }); refreshState(); refreshEvents(); }
    catch (e) { notify(e.message, false); }
  }

  async function setCoins(value) {
    try { await api('/admin/api/coins', { method: 'POST', body: JSON.stringify({ set: value }) }); refreshState(); refreshEvents(); }
    catch (e) { notify(e.message, false); }
  }

  async function toggleInhibit(denom, on) {
    try { await api('/admin/api/inhibit', { method: 'POST', body: JSON.stringify({ denom, on }) }); refreshState(); refreshEvents(); }
    catch (e) { notify(e.message, false); }
  }

  async function toggleDisable(disabled) {
    try { await api('/admin/api/disable', { method: 'POST', body: JSON.stringify({ disabled }) }); refreshState(); refreshEvents(); }
    catch (e) { notify(e.message, false); }
  }

  async function clearError() {
    try { await api('/admin/api/clear-error', { method: 'POST' }); refreshState(); refreshEvents(); }
    catch (e) { notify(e.message, false); }
  }

  async function testDispense(n) {
    try {
      await api('/admin/api/test-dispense', { method: 'POST', body: JSON.stringify({ coins: n }) });
      setTimeout(() => { refreshState(); refreshTransactions(); refreshEvents(); }, 1500 + n * 250);
    } catch (e) { notify(e.message, false); }
  }

  async function saveThreshold() {
    const v = Number(els.thresholdInput.value);
    if (!Number.isFinite(v) || v < 0) return notify('threshold ต้องเป็นตัวเลข ≥ 0', false);
    try { await api('/admin/api/settings', { method: 'POST', body: JSON.stringify({ low_coin_threshold: v }) }); refreshState(); }
    catch (e) { notify(e.message, false); }
  }

  async function logout() {
    await api('/admin/logout', { method: 'POST' });
    location.href = '/admin/login';
  }

  // ===== Event bindings =====

  // + / − แค่ "เลือกทิศทาง" + แสดง preview ในข้อความใต้ช่อง
  // ค่าใน field คือ delta ที่ user พิมพ์ (ไม่ถูก overwrite)
  // กดยืนยันถึงจะ commit ด้วย addCoins(±delta) — incremental, ไม่ใช่ set absolute
  function setPendingOp(op) {
    pendingOp = op;
    els.coinAddBtn.classList.toggle('ring-2', op === 'add');
    els.coinAddBtn.classList.toggle('ring-yellow-400', op === 'add');
    els.coinSubtractBtn.classList.toggle('ring-2', op === 'subtract');
    els.coinSubtractBtn.classList.toggle('ring-yellow-400', op === 'subtract');
    updateCoinPreview();
  }
  function updateCoinPreview() {
    const v = Number(els.coinCustom.value);
    if (!Number.isInteger(v) || v <= 0) { els.coinPreview.textContent = ''; return; }
    const newTotal = pendingOp === 'add' ? currentCoins + v : Math.max(0, currentCoins - v);
    const sign = pendingOp === 'add' ? '+' : '−';
    els.coinPreview.textContent = `→ ${currentCoins} ${sign} ${v} = ${newTotal}`;
  }
  els.coinCustom.addEventListener('input', updateCoinPreview);
  els.coinAddBtn.addEventListener('click', () => {
    const v = Number(els.coinCustom.value);
    if (!Number.isInteger(v) || v <= 0) return notify('ใส่จำนวนเป็นจำนวนเต็ม > 0', false);
    setPendingOp('add');
  });
  els.coinSubtractBtn.addEventListener('click', () => {
    const v = Number(els.coinCustom.value);
    if (!Number.isInteger(v) || v <= 0) return notify('ใส่จำนวนเป็นจำนวนเต็ม > 0', false);
    setPendingOp('subtract');
  });
  document.getElementById('coin-set-btn').addEventListener('click', () => {
    const v = Number(els.coinCustom.value);
    if (!Number.isInteger(v) || v <= 0) return notify('ใส่จำนวนเป็นจำนวนเต็ม > 0', false);
    const delta = pendingOp === 'add' ? v : -v;
    const newTotal = currentCoins + delta;
    if (newTotal < 0) return notify(`เหรียญในตู้มี ${currentCoins} ลด ${v} ไม่ได้`, false);
    const verb = pendingOp === 'add' ? 'เพิ่ม' : 'ลด';
    if (!confirm(`ยืนยัน ${verb} ${v} เหรียญ (${currentCoins} → ${newTotal})?`)) return;
    addCoins(delta);
    els.coinCustom.value = '';
    setPendingOp('add');   // reset เป็น default
  });
  setPendingOp('add');     // initial highlight
  document.getElementById('disable-btn').addEventListener('click', (e) => {
    const isDisabled = e.currentTarget.dataset.disabled === '1';
    toggleDisable(!isDisabled);
  });
  document.querySelector('[data-action="clear-error"]').addEventListener('click', clearError);
  document.getElementById('test-dispense-btn').addEventListener('click', () => {
    const n = Number(els.testCoins.value);
    if (!Number.isInteger(n) || n < 1 || n > 10) return notify('1-10 เหรียญเท่านั้น', false);
    testDispense(n);
  });
  document.getElementById('threshold-save').addEventListener('click', saveThreshold);
  document.getElementById('logout-btn').addEventListener('click', logout);

  // ===== WebSocket for live state (reuse same /ws) =====
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
          // Refresh full state (รวม inhibits ที่ /api/state เอามาให้)
          // เพื่อความเรียบง่าย: trigger refreshState() ทุกครั้งที่ state เปลี่ยน
          refreshState();
        }
        if (msg.type === 'event') {
          // refresh events list เมื่อมี event สำคัญ
          refreshEvents();
          if (msg.name === 'dispense_completed') refreshTransactions();
        }
      } catch {}
    });
    ws.addEventListener('close', () => setTimeout(connectWs, 2000));
  }

  // ===== Bootstrap =====
  refreshState();
  refreshTransactions();
  refreshEvents();
  connectWs();
  // Refresh log ทุก 10s กันพลาด event
  setInterval(refreshEvents, 10000);
})();
