// Customer screen — WebSocket client + scene controller
(() => {
  const scenes = {};
  document.querySelectorAll('[data-scene]').forEach(el => {
    scenes[el.dataset.scene] = el;
  });

  const els = {
    connPill:  document.getElementById('conn-pill'),
    connDot:   document.getElementById('conn-dot'),
    connText:  document.getElementById('conn-text'),
    coinCount: document.getElementById('coin-count'),
    billsTotal: document.getElementById('bills-total'),
    coinsExpected: document.getElementById('coins-expected'),
    coinsDone: document.getElementById('coins-done'),
    coinsTarget: document.getElementById('coins-target'),
    progressBar: document.getElementById('progress-bar'),
    completedBills: document.getElementById('completed-bills'),
    completedCoins: document.getElementById('completed-coins'),
    errorMessage: document.getElementById('error-message'),
    coinRain: document.getElementById('coin-rain'),
    acceptedDenoms: document.getElementById('accepted-denoms'),
    machineLabel: document.getElementById('machine-label'),
  };

  let currentScene = null;
  let completedScreenTimer = null;

  function showScene(name) {
    if (currentScene === name) return;
    Object.entries(scenes).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== name);
    });
    currentScene = name;
  }

  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth;            // restart animation
    el.classList.add('flash');
  }

  function setConnection(ok) {
    if (ok) {
      els.connDot.className = 'inline-block w-2 h-2 rounded-full bg-green-400 mr-2';
      els.connText.textContent = 'ออนไลน์';
      els.connPill.className = 'status-pill px-3 py-1 rounded-full text-sm font-medium bg-green-900/50 text-green-300';
    } else {
      els.connDot.className = 'inline-block w-2 h-2 rounded-full bg-red-400 mr-2';
      els.connText.textContent = 'ออฟไลน์';
      els.connPill.className = 'status-pill px-3 py-1 rounded-full text-sm font-medium bg-red-900/50 text-red-300';
    }
  }

  function dropCoin() {
    if (!els.coinRain) return;
    const coin = document.createElement('div');
    coin.className = 'w-14 h-14 rounded-full bg-yellow-400 text-slate-900 grid place-items-center text-xl font-black coin-drop';
    coin.textContent = '฿10';
    els.coinRain.appendChild(coin);
    setTimeout(() => coin.remove(), 1000);
  }

  function renderState(s) {
    // Machine label (header subtitle + page title)
    if (s.machineInfo && els.machineLabel) {
      const label = `${s.machineInfo.branch} / ${s.machineInfo.name}`;
      els.machineLabel.textContent = label;
      document.title = `ตู้แลกเหรียญ — ${label}`;
    }

    // Always-on widgets
    if (els.coinCount.textContent !== String(s.coinCount)) {
      els.coinCount.textContent = s.coinCount;
      flash(els.coinCount);
    }

    // รายการแบงค์ที่รับ — auto-hide แบงค์ที่ admin ปิด / เหรียญไม่พอ
    if (Array.isArray(s.acceptedDenoms)) {
      els.acceptedDenoms.textContent = s.acceptedDenoms.length
        ? s.acceptedDenoms.join(' / ')
        : '— ปิดรับชั่วคราว —';
    }

    // Connection
    setConnection(s.esp32Connected);

    // ⚠️ ถ้ามี "completed" screen แสดงค้างอยู่ — ปล่อยไปจนกว่า timer หมด
    if (currentScene === 'completed' && s.state === 'idle') return;

    // Scene selection
    switch (s.state) {
      case 'idle':
        showScene('idle');
        break;

      case 'receiving':
        showScene('receiving');
        if (els.billsTotal.textContent !== String(s.billsTotal)) {
          els.billsTotal.textContent = s.billsTotal;
          flash(els.billsTotal);
        }
        els.coinsExpected.textContent = s.coinsExpected;
        break;

      case 'dispensing':
        showScene('dispensing');
        els.coinsTarget.textContent = s.coinsExpected;
        els.coinsDone.textContent = s.coinsDispensed;
        const pct = s.coinsExpected > 0
          ? (s.coinsDispensed / s.coinsExpected) * 100
          : 0;
        els.progressBar.style.width = pct + '%';
        break;

      case 'error':
        showScene('error');
        els.errorMessage.textContent = s.error || '';
        break;

      case 'disabled':
        showScene('disabled');
        break;

      case 'offline':
        showScene('offline');
        break;
    }
  }

  function handleEvent(msg) {
    if (msg.name === 'dispense_completed') {
      // Show completed screen for 5 seconds before returning to idle
      const { bills, coins } = msg.payload;
      els.completedBills.textContent = bills;
      els.completedCoins.textContent = coins;
      showScene('completed');
      clearTimeout(completedScreenTimer);
      completedScreenTimer = setTimeout(() => {
        showScene('idle');
      }, 5000);
    }
    if (msg.name === 'low_coin') {
      // ลูกค้าไม่จำเป็นต้องเห็น — แค่ admin/Discord เห็น
      console.log('Low coin:', msg.payload);
    }
  }

  // Drop coins animation while dispensing — ฟัง state ครั้งแรกที่ coinsDispensed เพิ่ม
  let lastDispensed = 0;
  function maybeDropCoins(s) {
    if (s.state === 'dispensing' && s.coinsDispensed > lastDispensed) {
      for (let i = lastDispensed; i < s.coinsDispensed; i++) dropCoin();
    }
    if (s.state !== 'dispensing') lastDispensed = 0;
    else lastDispensed = s.coinsDispensed;
  }

  // ===== WebSocket connection =====
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.addEventListener('open', () => {
      console.log('WS connected');
    });

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
          renderState(msg.payload);
          maybeDropCoins(msg.payload);
        } else if (msg.type === 'event') {
          handleEvent(msg);
        }
      } catch (err) {
        console.warn('Bad WS message:', e.data);
      }
    });

    ws.addEventListener('close', () => {
      setConnection(false);
      showScene('offline');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  connect();
})();
