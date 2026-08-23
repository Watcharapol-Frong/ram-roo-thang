/**
 * =========================================================================
 * Google Apps Script สำหรับบันทึกผลแบบประเมิน "รามรู้ทาง" (Ram-Roo-Thang) ลง Google Sheets
 * =========================================================================
 * 
 * วิธีติดตั้งและเปิดใช้งาน (ใช้เวลา 1-2 นาที):
 * 1. เปิด Google Sheets ใหม่ (https://sheets.new)
 * 2. ตั้งชื่อ Sheet เช่น "ผลประเมิน_รามรู้ทาง_BetaTest"
 * 3. ไปที่เมนู "ส่วนขยาย" (Extensions) > "Apps Script"
 * 4. ลบโค้ดเดิมทั้งหมดในหน้าต่าง Apps Script แล้ววางโค้ดไฟล์นี้ลงไปทั้งหมด
 * 5. กดปุ่ม "บันทึก" (รูปแผ่นดิสก์)
 * 6. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 *    - เลือกประเภท: "เว็บแอป" (Web app)
 *    - คำอธิบาย: "Ram Roo Thang Feedback API"
 *    - ดำเนินการในฐานะ: "ฉัน" (Me)
 *    - ผู้ที่มีสิทธิ์เข้าถึง: "ทุกคน" (Anyone) **สำคัญมาก ต้องเลือก Anyone**
 * 7. กด "ทำให้ใช้งานได้" (Deploy) และอนุญาตสิทธิ์ (Authorize access)
 * 8. คัดลอก "URL เว็บแอป" (Web App URL) ที่ได้ (ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 9. นำ URL มาใส่ในตัวแปร FEEDBACK_ENDPOINT_URL ที่ต้นไฟล์ liff/app.js แล้ว deploy LIFF ใหม่
 *    (ถ้าไม่ใส่ ผลประเมินจะถูกเก็บใน localStorage ของเครื่องคนตอบเท่านั้น = เก็บกลับมาไม่ได้)
 *
 * หมายเหตุ: ฝั่ง LIFF ส่ง body มาเป็น Content-Type: text/plain (ทั้งที่เนื้อในเป็น JSON) โดยตั้งใจ
 * เพราะ application/json จะทำให้เบราว์เซอร์ยิง preflight OPTIONS ก่อน ซึ่ง Apps Script ไม่ตอบ
 * โค้ดข้างล่างอ่านจาก e.postData.contents ซึ่งได้ body ดิบอยู่แล้วไม่ว่า Content-Type จะเป็นอะไร
 */

const HEADERS = [
  'Timestamp',
  'User_ID',
  'Display_Name',
  'Device_OS',
  'Q1_Overall_Satisfaction',
  'Q2_Ease_Of_Use',
  'Q3_Speed_Performance',
  'Q4_Map_Accuracy_Rating',
  'Q5_Exam_Schedule_Rating',
  'Q6_Parking_Coins_Rating',
  'Q7_Most_Favorite_Feature',
  'Q8_Issues_Found',
  'Q9_NPS_Score',
  'Q10_Feature_Requests',
  'Q11_General_Comments'
];

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // สร้าง Header อัตโนมัติในแถวที่ 1 หากยังไม่มีข้อมูล
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      // จัดรูปแบบหัวตารางให้สวยงาม
      const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setBackground('#06c755');
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // แปลงข้อมูล JSON ที่ส่งมาจาก LINE LIFF
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      data = e.parameter;
    } else {
      throw new Error('No postData received');
    }

    const row = [
      data.timestamp || new Date().toISOString(),
      data.userId || 'N/A',
      data.displayName || 'N/A',
      data.deviceOS || 'Unknown',
      data.q1_overall_sat || '',
      data.q2_ease_of_use || '',
      data.q3_speed_perf || '',
      data.q4_map_rating || '',
      data.q5_schedule_rating || '',
      data.q6_parking_rating || '',
      data.q7_top_feature || '',
      Array.isArray(data.q8_issues_found) ? data.q8_issues_found.join(', ') : (data.q8_issues_found || ''),
      data.q9_nps_score !== undefined ? data.q9_nps_score : '',
      data.q10_feature_requests || '',
      data.q11_general_comments || ''
    ];

    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'บันทึกข้อมูลเรียบร้อยแล้ว'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'online',
    message: 'Ram Roo Thang Feedback API is working'
  })).setMimeType(ContentService.MimeType.JSON);
}
