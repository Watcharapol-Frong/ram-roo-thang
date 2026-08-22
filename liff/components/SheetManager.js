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
  }

  // ใช้ตอน on-campus (WALKING/DRIVING ภายในแคมปัส) — มีระยะทาง/เวลาจาก RouteCalculator แล้ว
  function showRouteSheet({ title, distanceText, durationText, actionLabel, onAction }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <h2>${title}</h2>
        <div class="nav-stats"><span>📏 ${distanceText}</span><span>⏱ ${durationText}</span></div>
        <button class="btn btn-primary" id="sheet-action-btn">${actionLabel}</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onAction);
  }

  // Scenario: อยู่นอก ม.รามฯ — ไม่คำนวณระยะเดิน/ขับข้ามเมือง ให้เปิด Google Maps ภายนอกแทน
  function showOffCampusSheet({ title, onOpenGoogleMaps }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <h2>${title}</h2>
        <p class="muted">📍 คุณอยู่นอกพื้นที่ ม.รามฯ แนะนำเดินทางด้วยรถยนต์หรือขนส่งสาธารณะมายังจุดนัดพบหลัก</p>
        <button class="btn btn-primary" id="sheet-action-btn">🚗 นำทางด้วย Google Maps</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onOpenGoogleMaps);
  }

  // ใช้ตอนหาเส้นทางไม่ได้เลย (Directions API คืน error) — ตอบตรงๆ ไม่เดา ไม่วาดเส้นผิด
  function showRouteErrorSheet({ title, onFocus }) {
    const slot = sheetSlot();
    if (!slot) return;
    slot.innerHTML = `
      <div class="nav-info-card">
        <h2>${title}</h2>
        <p class="muted">ไม่พบเส้นทางสำหรับตำแหน่งนี้ครับ</p>
        <button class="btn btn-primary" id="sheet-action-btn">🧭 ไปที่ตำแหน่งอาคาร</button>
      </div>
    `;
    document.getElementById('sheet-action-btn').addEventListener('click', onFocus);
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

  window.SheetManager = {
    hide,
    showRouteSheet,
    showOffCampusSheet,
    showRouteErrorSheet,
    showGpsWarning,
    hideGpsWarning,
  };
})();
