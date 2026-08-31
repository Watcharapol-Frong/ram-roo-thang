// liff/components/SheetManager.js
// ควบคุมการแสดงผล Bottom Action Sheet + Top Notice Bar (Module_2_Technical_Specification.md §4)
// เป็น pure UI layer — ไม่รู้เรื่อง Google Maps/Directions เลย รับแค่ข้อมูลที่ประกอบมาแล้วมาโชว์
//
// ใช้แบบ global script (ไม่มี build step ในโปรเจกต์นี้) — expose ผ่าน window.SheetManager

(function () {
  function sheetSlot() {
    return document.getElementById('action-sheet-slot');
  }
  function noticeSlot() {
    return document.getElementById('notice-bar-slot');
  }

  function hide() {
    const slot = sheetSlot();
    if (slot) slot.innerHTML = '';
    syncSheetHeight();
  }

  // ปุ่มควบคุมแผนที่อยู่มุมล่างขวา ต้องขยับหนีขึ้นเมื่อมีการ์ดโผล่มา ไม่งั้นโดนการ์ดทับ —
  // ความสูงการ์ดไม่คงที่ (บางแบบมีข้อความ บางแบบไม่มี) จึงวัดจริงแล้วส่งเป็น CSS variable ให้ CSS
  // เอาไปคำนวณเอง แทนการ hardcode ระยะไว้
  function syncSheetHeight() {
    const container = document.querySelector('.map-container');
    if (!container) return;
    const card = sheetSlot() && sheetSlot().firstElementChild;
    container.style.setProperty('--sheet-height', `${card ? card.offsetHeight : 0}px`);
  }

  // ใช้ตอน on-campus (WALKING/DRIVING ภายในแคมปัส) — มีระยะทาง/เวลาจาก RouteCalculator แล้ว
  // onClose มาจากผู้เรียก (app.js) เพราะการยกเลิกต้องล้าง state/เส้นทาง/หมุด ซึ่งอยู่นอก SheetManager
  let onCloseHandler = null;

  function bindClose() {
    const btn = document.getElementById('sheet-close-btn');
    if (btn && onCloseHandler) btn.addEventListener('click', onCloseHandler);
  }

  function setOnClose(handler) {
    onCloseHandler = handler;
  }

  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.1c.5.5 1.2.8 2 .8a3 3 0 100-6 3 3 0 00-3 3c0 .2 0 .5.1.7L8 9.8a3 3 0 100 4.4l7.1 4.2c0 .2-.1.4-.1.6a2.9 2.9 0 102.9-2.9z"/></svg>';

  function showRouteSheet({ title, distanceText, durationText, actionLabel, onAction, onShare }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <div class="sheet-actions">
          ${onShare ? `<button class="sheet-icon-btn" id="sheet-share-btn" aria-label="แชร์จุดนี้ให้เพื่อน">${SHARE_ICON}</button>` : ''}
          <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        </div>
        <h2>${title}</h2>
        <div class="nav-stats">
          <span><small>ระยะเวลา</small>${durationText}</span>
          <span><small>ระยะทาง</small>${distanceText}</span>
        </div>
        <button class="btn btn-primary" id="sheet-action-btn">${actionLabel}</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onAction);
    bindClose();
    syncSheetHeight();
  }

  // การ์ดอธิบายก่อนขอสิทธิ์ตำแหน่ง — ขึ้นก่อนหน้าขอสิทธิ์จริงของระบบ เพราะหน้าขอสิทธิ์ของ
  // เบราว์เซอร์กดปฏิเสธได้ครั้งเดียวแล้วจำถาวร ถ้าเด้งมาลอยๆ โดยผู้ใช้ยังไม่รู้ว่าจะเอาไปทำอะไร
  // โอกาสโดนกดปฏิเสธสูง แล้วจะแก้ยากมากหลังจากนั้น
  function showLocationPrimer({ onAllow, onSkip }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <h2>เปิดตำแหน่งก่อนไหม</h2>
        <p class="muted">จะได้เห็นว่าคุณอยู่ตรงไหนในมหาลัย และนำทางจากจุดที่ยืนอยู่จริงได้</p>
        <button class="btn btn-primary" id="primer-allow-btn">เปิดตำแหน่ง</button>
        <button class="btn btn-ghost" id="primer-skip-btn">ดูแผนที่ก่อน</button>
      </div>
    `;
    document.getElementById('primer-allow-btn').addEventListener('click', onAllow);
    document.getElementById('primer-skip-btn').addEventListener('click', onSkip);
    syncSheetHeight();
  }

  // ถึงลานจอดแล้ว — ให้ทั้งบันทึกรถและจบการนำทางอยู่ในการ์ดเดียว ผู้ใช้จะได้ไม่ต้องเลือกว่า
  // จะจบก่อนแล้วหาปุ่มบันทึกทีหลัง (ซึ่งเดิมหาไม่เจอ)
  function showParkingArrivalSheet({ title, onSaveCar, onFinish }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <h2>ถึง ${title} แล้ว</h2>
        <p class="muted sheet-hint">บันทึกตำแหน่งรถไว้ก่อนไหม จะได้กดนำทางกลับมาหาได้ตอนขากลับ</p>
        <button class="btn btn-primary" id="arrival-save-car-btn">บันทึกตำแหน่งรถ</button>
        <button class="btn btn-ghost" id="arrival-finish-btn">จบการนำทาง</button>
      </div>
    `;
    document.getElementById('arrival-save-car-btn').addEventListener('click', onSaveCar);
    document.getElementById('arrival-finish-btn').addEventListener('click', onFinish);
    syncSheetHeight();
  }

  // การ์ดตอนยืนอยู่ในลานจอด — เสนอสิ่งที่ทำได้ตรงจุดนั้นเลย ไม่ต้องให้ไปหาเมนูเอง
  // ปุ่มรายงานสภาพอยู่ต่อจากปุ่มจำที่จอด เพราะคนที่เพิ่งจอดเสร็จคือคนที่รู้สภาพลานดีที่สุดตอนนั้น
  const PARKING_REPORT_CHOICES = [
    { status: 'GREEN', label: 'เบาบาง' },
    { status: 'YELLOW', label: 'ปานกลาง' },
    { status: 'RED', label: 'หนาแน่น' },
  ];

  const reportChoicesHtml = PARKING_REPORT_CHOICES
    .map((c) => `<button class="report-btn report-${c.status.toLowerCase()}" data-status="${c.status}">${c.label}</button>`)
    .join('');

  function showParkingActionSheet({ title, savedNote, onSaveCar, onReport }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ปิด">&times;</button>
        <h2>คุณอยู่ที่ ${title}</h2>
        ${savedNote ? `<p class="muted sheet-hint">${savedNote}</p>` : ''}
        <button class="btn btn-primary" id="save-car-btn">${savedNote ? 'อัปเดตตำแหน่งรถ' : 'จดจำตำแหน่งรถ'}</button>
        <p class="muted report-label">สภาพที่จอดตอนนี้เป็นยังไง</p>
        <div class="report-choices">${reportChoicesHtml}</div>
      </div>
    `;
    document.getElementById('save-car-btn').addEventListener('click', onSaveCar);
    slot.querySelectorAll('.report-btn').forEach((btn) => {
      btn.addEventListener('click', () => onReport(btn.dataset.status));
    });
    bindClose();
    syncSheetHeight();
  }

  // ถามตอนเพิ่งออกจากลาน — คนที่เพิ่งเดินผ่านลานทั้งลานรู้สภาพจริงดีที่สุด และเป็นจังหวะที่
  // ไม่ได้รีบหาที่จอดแล้ว ต่างจากตอนขาเข้าที่กำลังมองหาช่องว่างอยู่ จึงตอบได้ตรงกว่า
  // ไม่มีปุ่มจำตำแหน่งรถเพราะขาออกไม่ใช่จังหวะที่จะบันทึกที่จอด
  function showParkingExitSheet({ title, onReport }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ปิด">&times;</button>
        <h2>ออกจากลานจอด ${title} แล้ว</h2>
        <p class="muted sheet-hint">ตอนนี้ในลานเป็นยังไงบ้าง บอกไว้หน่อยจะได้ช่วยคนที่กำลังจะเข้ามา</p>
        <div class="report-choices">${reportChoicesHtml}</div>
      </div>
    `;
    slot.querySelectorAll('.report-btn').forEach((btn) => {
      btn.addEventListener('click', () => onReport(btn.dataset.status));
    });
    bindClose();
    syncSheetHeight();
  }

  // Scenario: ไม่ได้สิทธิ์ GPS — ไม่รู้ว่าผู้ใช้อยู่ไหน จึงไม่ควรมีปุ่ม "เริ่มเดินทาง" เพราะการนำทาง
  // แบบเลี้ยวซ้ายเลี้ยวขวาจากจุดที่เดาเอาเองอันตรายกว่าไม่มีให้เลย — เปลี่ยนเป็นชวนเปิดตำแหน่งแทน
  // ซึ่งเป็นสิ่งเดียวที่ทำแล้วสถานการณ์ดีขึ้นจริง ส่วนระยะทางยังบอกไว้เป็นข้อมูลอ้างอิงคร่าวๆ
  function showGpsDeniedSheet({ title, distanceText, durationText, onEnableLocation }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        <div class="nav-stats">
          <span><small>ระยะเวลา</small>${durationText}</span>
          <span><small>ระยะทาง</small>${distanceText}</span>
        </div>
        <p class="muted sheet-hint">ตัวเลขนี้วัดจากประตูหน้ามหาวิทยาลัย เปิดตำแหน่งเพื่อดูเส้นทางจากจุดที่คุณยืนอยู่จริง</p>
        <button class="btn btn-primary" id="sheet-action-btn">เปิดตำแหน่ง</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onEnableLocation);
    bindClose();
    syncSheetHeight();
  }

  // Scenario: อยู่นอก ม.รามฯ — ไม่คำนวณระยะเดิน/ขับข้ามเมือง ให้เปิด Google Maps ภายนอกแทน
  // ปลายทางคือ "ลานจอดที่ใกล้จุดหมายที่สุด" ไม่ใช่ประตูหน้า — บอกชื่อลานกับสถานะไปด้วยเลย
  // ผู้ใช้จะได้รู้ตั้งแต่ยังไม่ออกรถว่าจะไปจอดตรงไหนและตอนนี้เต็มหรือยัง
  function showOffCampusSheet({ title, parkingName, parkingStatus, onOpenGoogleMaps }) {
    const slot = sheetSlot();
    if (!slot) return;
    const destination = parkingName
      ? `<p class="muted">อยู่นอก ม.รามฯ พาไปจอดที่ <strong>${parkingName}</strong>` +
        ` ซึ่งใกล้จุดหมายที่สุด${parkingStatus ? ` (ตอนนี้${parkingStatus})` : ''}</p>`
      : '<p class="muted">อยู่นอก ม.รามฯ พาไปที่ประตูหน้ามหาวิทยาลัย</p>';
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        ${destination}
        <button class="btn btn-primary" id="sheet-action-btn">นำทางด้วย Google Maps</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onOpenGoogleMaps);
    bindClose();
    syncSheetHeight();
  }

  // ใช้ตอนหาเส้นทางไม่ได้เลย (Directions API คืน error) — ตอบตรงๆ ไม่เดา ไม่วาดเส้นผิด
  function showRouteErrorSheet({ title, onFocus }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <button class="sheet-close" id="sheet-close-btn" aria-label="ยกเลิกจุดหมาย">&times;</button>
        <h2>${title}</h2>
        <p class="muted">ไม่พบเส้นทางสำหรับตำแหน่งนี้ครับ</p>
        <button class="btn btn-primary" id="sheet-action-btn">ไปที่ตำแหน่งอาคาร</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onFocus);
    bindClose();
    syncSheetHeight();
  }

  // การ์ดระหว่างนำทาง — ตัดปุ่ม "เริ่มเดินทาง" ออก เหลือระยะที่เหลือกับปุ่มจบการนำทาง
  // ไม่ใส่ปุ่มกากบาทเพราะการหยุดนำทางควรตั้งใจกด ไม่ใช่เผลอปัดโดนแล้วเส้นทางหาย
  function showNavigationSheet({ title, remainingText, etaText, onStop }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <div class="sheet-handle"></div>
        <h2>${title}</h2>
        <div class="nav-stats">
          <span><small>เหลืออีก</small>${remainingText}</span>
          <span><small>ถึงใน</small>${etaText}</span>
        </div>
        <button class="btn btn-ghost" id="sheet-stop-btn">จบการนำทาง</button>
      </div>
    `;
    document.getElementById('sheet-stop-btn').addEventListener('click', onStop);
    syncSheetHeight();
  }

  // อัปเดตแค่ตัวเลขระหว่างเดิน ไม่ต้องเขียน innerHTML ใหม่ทั้งการ์ด ไม่งั้นปุ่มจะถูกสร้างใหม่
  // ทุกครั้งที่ GPS ขยับ แล้ว event listener หลุด
  function updateNavigationStats(remainingText, etaText) {
    const stats = sheetSlot() && sheetSlot().querySelectorAll('.nav-stats span');
    if (!stats || stats.length < 2) return;
    stats[0].innerHTML = `<small>เหลืออีก</small>${remainingText}`;
    stats[1].innerHTML = `<small>ถึงใน</small>${etaText}`;
  }

  // ข้อความแจ้งสั้นๆ ที่หายเองใน 3 วิ — ใช้บอกเหตุผลเวลากดปุ่มแล้วไม่เกิดอะไร (เช่น อยู่นอกรั้ว)
  // ไม่ใช้ alert เพราะบล็อกทั้งหน้าและหน้าตาไม่เข้ากับแอป
  let noticeTimer = null;

  function showNotice(message) {
    const slot = noticeSlot();
    if (!slot) return;
    slot.innerHTML = `<div class="notice-bar"><p>${message}</p></div>`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (noticeSlot()) noticeSlot().innerHTML = ''; }, 3000);
  }

  function showGpsWarning(onRetry) {
    const slot = noticeSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="notice-bar">
        <p>⚠️ เพื่อความแม่นยำในการนำทาง กรุณาเปิดใช้งานตำแหน่ง (GPS) บนอุปกรณ์ของคุณ</p>
        <button class="btn" id="gps-retry-btn">🔄 ลองอีกครั้ง</button>
      </div>
    `;
    document.getElementById('gps-retry-btn').addEventListener('click', onRetry);
  }

  function hideGpsWarning() {
    const slot = noticeSlot();
    if (slot) slot.innerHTML = '';
  }

  // popup ยืนยันแบบเต็มจอ — ใช้แทน window.confirm ของเบราว์เซอร์
  //
  // window.confirm ใน LINE in-app browser หน้าตาเป็นกล่องระบบที่ดูหลุดจากแอปทั้งหมด
  // และบางเครื่องก็ถูกบล็อก ทำให้ผู้ใช้กดแลกไม่ได้เลยโดยไม่มีอะไรบอก
  function showConfirm({ title, body, note, confirmLabel, cancelLabel, onConfirm }) {
    const existing = document.getElementById('app-confirm');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'app-confirm';
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <h3 class="confirm-title"></h3>
        <p class="confirm-body"></p>
        ${note ? '<p class="confirm-note"></p>' : ''}
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel"></button>
          <button type="button" class="confirm-ok"></button>
        </div>
      </div>
    `;
    // ใส่ข้อความผ่าน textContent ไม่ใช่ innerHTML — ชื่อสินค้ามาจากฐานข้อมูลที่แอดมินแก้ได้
    overlay.querySelector('.confirm-title').textContent = title || 'ยืนยัน';
    overlay.querySelector('.confirm-body').textContent = body || '';
    if (note) overlay.querySelector('.confirm-note').textContent = note;
    overlay.querySelector('.confirm-cancel').textContent = cancelLabel || 'ยกเลิก';
    overlay.querySelector('.confirm-ok').textContent = confirmLabel || 'ยืนยัน';

    const close = () => overlay.remove();
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      close();
      if (typeof onConfirm === 'function') onConfirm();
    });

    document.body.appendChild(overlay);
  }

  window.SheetManager = {
    hide,
    setOnClose,
    showLocationPrimer,
    showParkingActionSheet,
    showParkingArrivalSheet,
    showParkingExitSheet,
    showRouteSheet,
    showGpsDeniedSheet,
    showNavigationSheet,
    updateNavigationStats,
    showOffCampusSheet,
    showRouteErrorSheet,
    showNotice,
    showConfirm,
    showGpsWarning,
    hideGpsWarning,
  };
})();
