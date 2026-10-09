import QRCode from "qrcode";
import dotenv from "dotenv";

dotenv.config();

export class QrService {
  /**
   * สร้าง Base64 Data URL สำหรับ QR Code เพื่อให้ไรเดอร์สแกนเข้าถึงใบงาน
   */
  public static async generateTaskQrCode(taskNumber: string): Promise<string> {
    const clientUrl = process.env.CLIENT_URL || "http://localhost:4200";
    const riderTaskUrl = `${clientUrl}/rider/${taskNumber}`;

    try {
      const qrDataUrl = await QRCode.toDataURL(riderTaskUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: "#1E293B",
          light: "#FFFFFF",
        },
      });
      return qrDataUrl;
    } catch (err) {
      console.error("Error generating QR code:", err);
      throw new Error("Failed to generate QR code");
    }
  }
}
