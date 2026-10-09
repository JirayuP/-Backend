# 🚀 Smart Lunch Delivery - Backend API

ระบบ Backend RESTful API พัฒนาด้วย Node.js, Express, TypeScript และ Prisma ORM สำหรับระบบจัดเส้นทางและแบ่งงานไรเดอร์อัจฉริยะ (พร้อมไฟล์คอนฟิกสำหรับ Railway และ Docker)

---

## 🛠️ Tech Stack
- **Runtime:** Node.js (v18+)
- **Framework:** Express.js (TypeScript)
- **Database ORM:** Prisma ORM (MySQL / MariaDB)
- **Platform Support:** Railway.app, Docker, Docker Compose, Linux VPS

---

## 🚂 วิธี Deploy บน Railway (railway.app) แบบ Step-by-Step

โปรเจกต์นี้มีไฟล์ `railway.json`, `Dockerfile` และสคริปต์ Sync Database อัตโนมัติ (`scripts/start.js`) รองรับ Railway แบบ Zero-Config:

### ขั้นตอนที่ 1: สร้าง Project & เพิ่ม MySQL บน Railway
1. เข้าเว็บ [Railway.app](https://railway.app/) และล็อกอิน
2. กด **"+ New Project"**
3. เลือก **"Provision MySQL"** (Railway จะสร้างฐานข้อมูล MySQL ให้ทันที)

### ขั้นตอนที่ 2: เพิ่ม Backend Service จาก GitHub
1. ในโปรเจกต์เดิม กดปุ่ม **"+ Create"** หรือ **"+ New"**
2. เลือก **"GitHub Repo"** แล้วเลือก **`JirayuP/-Backend`**

### ขั้นตอนที่ 3: ตั้งค่า Environment Variables (เชื่อม Database)
1. คลิกที่กล่องบริการ Backend ที่เพิ่งเพิ่ม
2. ไปที่แท็บ **"Variables"**
3. กด **"Add Reference"** หรือสร้างตัวแปร:
   ```text
   DATABASE_URL = ${{MySQL.MYSQL_URL}}
   ```
   *(หรือถ้าใช้ชื่อ `DATABASE_URL` จาก MySQL plugin ก็เลือกใส่ค่านั้นได้เลย)*
4. Railway จะตั้งค่า `$PORT` ให้โดยอัตโนมัติ

### ขั้นตอนที่ 4: สร้าง Public Domain เพื่อใช้งาน
1. ไปที่แท็บ **"Settings"** ของบริการ Backend
2. เลื่อนลงมาที่หัวข้อ **"Networking"** -> กดปุ่ม **"Generate Domain"**
3. จะได้ URL เช่น: `https://backend-production-xxxx.up.railway.app`
4. ตรวจสอบสถานะ Server ได้ที่: `https://<your-railway-url>/api/health`

> **Note:** เมื่อ Deploy บน Railway สคริปต์ `scripts/start.js` จะรันคำสั่ง `npx prisma db push` เพื่อสร้างตารางฐานข้อมูลใน MySQL ให้โดยอัตโนมัติทันที!

---

## ⚙️ การตั้งค่า Environment Variables ในเครื่อง (`.env`)
คัดลอกไฟล์ `.env.example` เป็น `.env`:
```bash
PORT=3000
DATABASE_URL="mysql://root:password@localhost:3306/lunch_delivery"
```

---

## 🐳 วิธีการ Deploy ทางเลือกอื่นๆ

### วิธีที่ 1: Deploy ด้วย Docker Compose (บน VPS)
```bash
docker compose up -d --build
```

### วิธีที่ 2: รันด้วย PM2 บน Linux Server
```bash
npm install
npm run build
npx prisma db push
pm2 start dist/index.js --name "lunch-backend"
```

---

## 📡 Health Check API
```http
GET /api/health
```
Response:
```json
{
  "status": "ok",
  "service": "Smart Lunch Delivery Route Optimization API",
  "time": "2026-10-09T..."
}
```
