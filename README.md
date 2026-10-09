# 🚀 Smart Lunch Delivery - Backend API

ระบบ Backend RESTful API พัฒนาด้วย Node.js, Express, TypeScript และ Prisma ORM สำหรับระบบจัดเส้นทางและแบ่งงานไรเดอร์อัจฉริยะ

---

## 🛠️ Tech Stack
- **Runtime:** Node.js (v18+)
- **Framework:** Express.js (TypeScript)
- **Database ORM:** Prisma ORM (MySQL / MariaDB)
- **Containerization:** Docker & Docker Compose

---

## ⚙️ การตั้งค่า Environment Variables (`.env`)
คัดลอกไฟล์ `.env.example` เป็น `.env`:
```bash
PORT=3000
DATABASE_URL="mysql://root:password@localhost:3306/lunch_delivery"
```

---

## 🚀 วิธีการ Deploy ผ่าน Server ต่างๆ

### วิธีที่ 1: Deploy ด้วย Docker Compose (แนะนำสำหรับ VPS ทุกค่าย เช่น DigitalOcean, AWS EC2, Linode, Ubuntu Server)
รันคำสั่งเดียว ระบบจะสร้างทั้ง Backend และ MySQL Database พร้อมใช้งาน:
```bash
docker compose up -d --build
```
ตรวจสอบสถานะ:
```bash
docker compose ps
docker compose logs -f app
```

---

### วิธีที่ 2: Deploy ด้วย Docker Container เดียว (มี Database แยกอยู่แล้ว)
```bash
# 1. Build image
docker build -t lunch-backend .

# 2. Run container
docker run -d \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DATABASE_URL="mysql://user:pass@host:3306/lunch_delivery" \
  --name lunch_backend_container \
  lunch-backend
```

---

### วิธีที่ 3: Deploy บน Cloud Platform (Render / Railway / Fly.io)
1. **Render.com / Railway.app:**
   - เชื่อมต่อ GitHub Repository
   - กำหนด **Root Directory:** `.` (หรือ `backend`)
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - ตั้งค่า **Environment Variables:**
     - `PORT`: `3000` (หรือตามที่ Cloud กำหนด)
     - `DATABASE_URL`: `mysql://...` จาก Cloud Database (Aiven, PlanetScale, Railway MySQL, หรือ Supabase)

---

### วิธีที่ 4: รันแบบ Manual บน Linux Server ด้วย PM2
```bash
# ติดตั้ง dependencies และ build
npm install
npm run build

# รัน Migration / Push schema
npx prisma db push

# สตาร์ทด้วย PM2
npm install -g pm2
pm2 start dist/index.js --name "lunch-backend"
pm2 save
```

---

## 📡 Health Check API
```http
GET http://localhost:3000/api/health
```
Response:
```json
{
  "status": "ok",
  "service": "Smart Lunch Delivery Route Optimization API",
  "time": "2026-10-09T..."
}
```
