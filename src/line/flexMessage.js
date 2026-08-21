export function generateFlexMessage(buildingName, buildingDesc, liffUrl) {
  const actionUri = liffUrl || "https://line.me";
  return {
    type: "flex",
    altText: `ข้อมูล${buildingName}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              {
                type: "box", layout: "vertical",
                contents: [
                  { type: "text", text: buildingName, weight: "bold", size: "lg", color: "#111111" },
                  { type: "text", text: buildingDesc, size: "xs", color: "#666666", margin: "xs" }
                ],
                flex: 4
              },
              {
                type: "box", layout: "vertical", backgroundColor: "#EAF9F1", cornerRadius: "8px", justifyContent: "center", alignItems: "center", width: "32px", height: "32px",
                contents: [{ type: "text", text: "📍", size: "sm" }], flex: 0
              }
            ]
          },
          { type: "separator", margin: "md", color: "#EAEAEA" },
          {
            type: "box", layout: "horizontal", margin: "md", alignItems: "center",
            contents: [
              { type: "text", text: "ℹ️", size: "xs", flex: 0 },
              { type: "text", text: "แตะปุ่มด้านล่างเพื่อเปิดแผนที่และดูที่จอดรถ", size: "xxs", color: "#666666", wrap: true, margin: "sm" }
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingTop: "0px", paddingStart: "16px", paddingEnd: "16px", paddingBottom: "16px",
        contents: [
          {
            type: "button", style: "primary", color: "#06C755", height: "sm",
            action: { type: "uri", label: "เปิดระบบนำทาง & ที่จอดรถ", uri: actionUri }
          }
        ]
      },
      styles: { footer: { separator: false } }
    }
  };
}
