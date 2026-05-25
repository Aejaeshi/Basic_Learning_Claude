import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { coins, events, transactions, settings } from './db.js';

/**
 * MachineStateMachine — business logic ของตู้แลกเหรียญ
 *
 * State: IDLE | RECEIVING | DISPENSING | ERROR | DISABLED | OFFLINE
 *
 * Inputs:
 *   - ESP32 events (bill_pulse, coin_dispensed, dispense_done, ...)
 *   - admin actions (disable, enable, clearError)
 *
 * Outputs:
 *   - ESP32 commands (dispense, inhibit, stop)
 *   - emit 'state' ทุกครั้งที่ state เปลี่ยน — UI ฟัง
 *   - log to DB
 */

export const STATES = Object.freeze({
  IDLE: 'idle',
  RECEIVING: 'receiving',
  DISPENSING: 'dispensing',
  ERROR: 'error',
  DISABLED: 'disabled',
  OFFLINE: 'offline',
});

export class Machine extends EventEmitter {
  constructor(esp32) {
    super();
    this.esp32 = esp32;

    this.state = STATES.OFFLINE;
    this.billsTotal = 0;        // บาท สะสมใน session ปัจจุบัน
    this.coinsExpected = 0;     // เหรียญที่จะจ่ายใน session ปัจจุบัน
    this.coinsDispensed = 0;    // ที่จ่ายแล้วใน session
    this.currentTxnId = null;
    this.errorMessage = null;
    this._billTimer = null;
    this._dispenseTimeout = null;

    this._wireEsp32();
  }

  _wireEsp32() {
    this.esp32.on('connected', () => this._onEsp32Connected());
    this.esp32.on('disconnected', () => this._onEsp32Disconnected());
    this.esp32.on('event', (msg) => this._onEsp32Event(msg));
  }

  // ===== Public API =====

  getState() {
    const inhibited = new Set(this._computeInhibited());
    const acceptedDenoms = config.business.validDenoms.filter(d => !inhibited.has(d));
    return {
      machineInfo: { ...config.machine },   // { name, branch } — ติดทุก state broadcast
      state: this.state,
      billsTotal: this.billsTotal,
      coinsExpected: this.coinsExpected,
      coinsDispensed: this.coinsDispensed,
      coinCount: coins.current(),
      lowCoinThreshold: settings.getNumber('low_coin_threshold', 100),
      error: this.errorMessage,
      esp32Connected: this.esp32.connected,
      acceptedDenoms,   // denom ที่ NK77 รับอยู่ตอนนี้ (ลูกค้าเห็น)
    };
  }

  disable() {
    settings.set('machine_disabled', '1');
    this._sendCmd('disable_all');
    this._transition(STATES.DISABLED);
  }

  enable() {
    settings.set('machine_disabled', '0');
    this._applyInhibits();
    this._transition(STATES.IDLE);
  }

  clearError() {
    if (this.state === STATES.ERROR) {
      this.errorMessage = null;
      this._reset();
      this._transition(STATES.IDLE);
    }
  }

  // ===== ESP32 event handlers =====

  _onEsp32Connected() {
    events.log('info', 'machine', 'esp32_connected');
    if (settings.getBool('machine_disabled')) {
      this._sendCmd('disable_all');
      this._transition(STATES.DISABLED);
    } else {
      this._applyInhibits();
      if (this.state === STATES.OFFLINE) this._transition(STATES.IDLE);
    }
  }

  _onEsp32Disconnected() {
    events.log('warn', 'machine', 'esp32_disconnected');
    this._transition(STATES.OFFLINE);
  }

  _onEsp32Event(msg) {
    if (msg.type !== 'event') return;

    switch (msg.name) {
      case 'bill_pulse':
        this._onBillPulse(msg.amount || 10);
        break;
      case 'coin_dispensed':
        this._onCoinDispensed();
        break;
      case 'dispense_done':
        this._onDispenseDone(msg.total);
        break;
      case 'dispense_failed':
        this._onDispenseFailed(msg.reason, msg.dispensed, msg.expected);
        break;
      case 'error':
        events.log('error', 'esp32', msg.code || 'unknown', msg);
        break;
    }
  }

  _onBillPulse(amount) {
    if (this.state === STATES.OFFLINE ||
        this.state === STATES.DISABLED ||
        this.state === STATES.DISPENSING ||
        this.state === STATES.ERROR) {
      // ⚠️ pulse เข้ามาในสถานะที่ไม่ควรรับ — log
      events.log('warn', 'machine', 'bill_pulse_in_wrong_state', { state: this.state, amount });
      return;
    }

    this.billsTotal += amount;
    this.coinsExpected = Math.floor(this.billsTotal / config.business.coinValueBaht);

    if (this.state === STATES.IDLE) this._transition(STATES.RECEIVING);
    else this._emitStateChange();   // อยู่ใน RECEIVING แล้ว แค่อัปเดตตัวเลข

    // debounce: รอ 2 วินาที ถ้าไม่มี pulse เพิ่ม → เริ่ม dispense
    clearTimeout(this._billTimer);
    this._billTimer = setTimeout(() => this._startDispense(), config.business.billTimeoutMs);
  }

  _startDispense() {
    if (this.state !== STATES.RECEIVING) return;
    if (this.coinsExpected <= 0) {
      this._reset();
      this._transition(STATES.IDLE);
      return;
    }

    // ⚠️ Double-check coin availability ก่อนสั่ง dispense
    const available = coins.current();
    if (available < this.coinsExpected) {
      this._setError(`เหรียญในตู้ไม่พอ (มี ${available} ต้องการ ${this.coinsExpected})`);
      return;
    }

    // log ก่อน dispense — กันไฟดับ
    this.currentTxnId = transactions.start(this.billsTotal, this.coinsExpected);
    events.log('info', 'machine', 'dispense_start', {
      txn: this.currentTxnId, bills: this.billsTotal, coins: this.coinsExpected,
    });

    this.coinsDispensed = 0;
    this._transition(STATES.DISPENSING);
    this._sendCmd('dispense', { coins: this.coinsExpected });

    // safety timeout: คาดว่าใช้เวลา ~300ms/เหรียญ × N + buffer 10s
    const timeoutMs = this.coinsExpected * 400 + 10_000;
    clearTimeout(this._dispenseTimeout);
    this._dispenseTimeout = setTimeout(() => {
      this._setError(`Dispense timeout (ได้ ${this.coinsDispensed}/${this.coinsExpected})`);
    }, timeoutMs);
  }

  _onCoinDispensed() {
    if (this.state !== STATES.DISPENSING) return;
    this.coinsDispensed++;
    if (this.currentTxnId) transactions.updateDispensed(this.currentTxnId, this.coinsDispensed);
    this._emitStateChange();
  }

  _onDispenseDone(total) {
    if (this.state !== STATES.DISPENSING) return;
    clearTimeout(this._dispenseTimeout);

    // หัก coin_count
    const remaining = coins.add(-this.coinsDispensed, 'dispense');
    if (this.currentTxnId) transactions.complete(this.currentTxnId, 'completed');

    events.log('info', 'machine', 'dispense_done', {
      txn: this.currentTxnId, dispensed: this.coinsDispensed, remaining,
    });

    this.emit('dispense_completed', {
      txnId: this.currentTxnId,
      bills: this.billsTotal,
      coins: this.coinsDispensed,
      coinsRemaining: remaining,
    });

    this._reset();
    this._transition(STATES.IDLE);

    // ตรวจ low coin
    this._checkLowCoin(remaining);
  }

  _onDispenseFailed(reason, dispensed, expected) {
    clearTimeout(this._dispenseTimeout);
    if (this.currentTxnId) {
      transactions.updateDispensed(this.currentTxnId, dispensed);
      transactions.complete(this.currentTxnId, 'jammed', reason);
    }
    coins.add(-dispensed, 'dispense_partial');
    this._setError(`Hopper ${reason} — จ่ายได้ ${dispensed}/${expected} เหรียญ`);
  }

  _setError(message) {
    this.errorMessage = message;
    events.log('error', 'machine', 'error', { message });
    this.emit('error_occurred', { message });
    this._transition(STATES.ERROR);
  }

  _checkLowCoin(remaining) {
    const threshold = settings.getNumber('low_coin_threshold', 100);
    if (remaining <= threshold) {
      this.emit('low_coin', { remaining, threshold });
    }
    // re-apply inhibits — อาจต้องปิดแบงค์ใหญ่
    this._applyInhibits();
  }

  // คำนวณ denom ที่ "ถูก inhibit" — admin ปิดเอง + auto-ปิดแบงค์ใหญ่เมื่อเหรียญน้อย
  // ใช้ทั้งใน _applyInhibits (ส่งไป ESP32) และ getState (ส่งให้ลูกค้าดู)
  _computeInhibited() {
    const available = coins.current();
    const adminDisabled = config.business.validDenoms.filter(d =>
      settings.getBool(`inhibit_${d}`)
    );
    const tooBig = config.business.validDenoms.filter(d =>
      Math.floor(d / config.business.coinValueBaht) > available
    );
    return [...new Set([...adminDisabled, ...tooBig])];
  }

  _applyInhibits() {
    this._sendCmd('inhibit', { denoms: this._computeInhibited() });
  }

  _reset() {
    clearTimeout(this._billTimer);
    clearTimeout(this._dispenseTimeout);
    this.billsTotal = 0;
    this.coinsExpected = 0;
    this.coinsDispensed = 0;
    this.currentTxnId = null;
  }

  _transition(newState) {
    if (this.state === newState) {
      this._emitStateChange();
      return;
    }
    const from = this.state;
    this.state = newState;
    events.log('info', 'machine', 'state_change', { from, to: newState });
    this._emitStateChange();
  }

  _emitStateChange() {
    this.emit('state', this.getState());
  }

  _sendCmd(name, payload = {}) {
    this.esp32.send({ type: 'cmd', name, ...payload });
  }
}
