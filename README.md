# 🍱 Smart Lunch Delivery - Backend API
> **Route Optimization & Rider Task Allocation System**  
> ระบบ RESTful Web API สำหรับคำนวณเส้นทางและแบ่งงานไรเดอร์ส่งอาหารมื้อเที่ยง เชื่อมต่อกับฐานข้อมูล **MySQL** ด้วย **Prisma ORM**

---

## 🛠️ โครงสร้างเทคโนโลยี (Tech Stack)
- **Runtime:** Node.js (v18+)
- **Framework:** Express.js (TypeScript)
- **Build Tool:** esbuild (Bundle รวดเร็วสำหรับ Production)
- **Database ORM:** Prisma ORM (MySQL / MariaDB)

---

## 🚀 วิธีการติดตั้งและรันระบบ (Local Development)

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. สร้าง Prisma Client (เชื่อมต่อ MySQL)
```bash
npx prisma generate
```

### 3. รันระบบสำหรับ Development (Hot-reload)
```bash
npm run dev
```
เซิร์ฟเวอร์จะเปิดทำงานที่: **http://localhost:3000**

### 4. Build และรันในโหมด Production
```bash
npm run build
npm start
```

---

## 🚂 วิธี Deploy บน Railway (ไม่ใช้ Docker / ใช้ Native Node.js)

Railway จะตรวจจับโปรเจกต์เป็น Node.js อัตโนมัติ (ผ่าน Nixpacks) เหมือนกับ `customer-order-api`:

### 1. สร้าง MySQL บน Railway
1. ไปที่โปรเจกต์บน [Railway.app](https://railway.app/)
2. กด **"+ Create"** -> **"Database"** -> **"Add MySQL"**

### 2. เชื่อมต่อ GitHub Repository
1. กด **"+ Create"** -> **"GitHub Repo"**
2. เลือก Repository: **`JirayuP/-Backend`**

### 3. ตั้งค่าตัวแปรสภาพแวดล้อม (Variables)
1. เข้าไปที่ Service Backend ของคุณ
2. ไปที่แท็บ **Variables**
3. เพิ่มตัวแปร:
   ```text
   DATABASE_URL = ${{MySQL.MYSQL_URL}}
   ```
   *(หรือใส่ MySQL Connection String จาก Database)*

### 4. ตรวจสอบการ Build & Start
Railway จะตรวจจับและรันคำสั่งจาก `package.json` ให้อัตโนมัติ:
- **Build Command:** `npm run build` (รัน `prisma generate` และ bundle ด้วย `esbuild`)
- **Start Command:** `npm start` (รัน `node dist/index.js`)

### 5. สร้าง Public Domain (Networking)
1. ไปที่แท็บ **Settings** -> หัวข้อ **Networking**
2. กด **Generate Domain** จะได้ URL ใช้งาน เช่น `https://xxxx.up.railway.app`
3. ทดสอบเรียกดูสถานะที่: `https://xxxx.up.railway.app/api/health`

---

## 📋 API Endpoints สรุป

| Method | Endpoint | รายละเอียด |
|---|---|---|
| **GET** | `/api/health` | ตรวจสอบสถานะการทำงานของเซิร์ฟเวอร์ |
| **GET** | `/api/customers` | จัดการข้อมูลลูกค้าและพิกัดจัดส่ง |
| **GET** | `/api/orders` | ดูรายการสั่งซื้อทั้งหมด |
| **POST** | `/api/orders/seed` | จำลองข้อมูลคำสั่งซื้ออัตโนมัติ |
| **POST** | `/api/routes/optimize` | คำนวณจับกลุ่มและจัดลำดับเส้นทางไรเดอร์ (VRP + 2-Opt) |
| **POST** | `/api/routes/confirm` | ยืนยันปล่อยงานและสร้าง Delivery Task ให้ไรเดอร์ |
| **GET** | `/api/tasks/:taskCode` | ดูรายละเอียดใบงานไรเดอร์และ QR Code |
| **PATCH**| `/api/tasks/:taskCode/status` | อัปเดตสถานะการจัดส่งของไรเดอร์ |
