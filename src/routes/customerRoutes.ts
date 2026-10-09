import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { BUSINESS_RULES } from "../constants";
import { calculateStraightDistanceKm } from "../utils/geo";

const router = Router();

// ========================================================
// 1. ค้นหาลูกค้าในระยะทางที่กำหนด (เช่น 1 กิโลเมตร)
// GET /api/customers/nearby?lat=16.246825&lng=103.252072&radius=1
// ========================================================
router.get("/nearby", async (req: Request, res: Response) => {
  try {
    const hub = BUSINESS_RULES.HUB;
    const centerLat = req.query.lat ? parseFloat(String(req.query.lat)) : hub.latitude;
    const centerLng = req.query.lng ? parseFloat(String(req.query.lng)) : hub.longitude;
    const radiusKm = req.query.radius ? parseFloat(String(req.query.radius)) : 1.0;

    if (isNaN(centerLat) || isNaN(centerLng) || isNaN(radiusKm)) {
      return res.status(400).json({ error: "พิกัด lat, lng หรือ radius ไม่ถูกต้อง" });
    }

    const customers = await prisma.customer.findMany({
      include: {
        _count: { select: { orders: true } },
      },
      orderBy: { id: "asc" },
    });

    const nearbyCustomers = (customers as any[])
      .map((c: any) => {
        const distanceKm = calculateStraightDistanceKm(
          { latitude: centerLat, longitude: centerLng },
          { latitude: c.latitude, longitude: c.longitude }
        );
        return {
          ...c,
          distanceKm,
        };
      })
      .filter((c: any) => c.distanceKm <= radiusKm)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm);

    res.json({
      center: { latitude: centerLat, longitude: centerLng },
      radiusKm,
      count: nearbyCustomers.length,
      customers: nearbyCustomers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 2. ค้นหาลูกค้าจากส่วนหนึ่งของชื่อ หรือนามสกุล
// GET /api/customers/search?name=พลอย
// ========================================================
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = String(req.query.name || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "กรุณาระบุคำค้นหา ?name=..." });
    }

    const customers = await prisma.customer.findMany({
      where: {
        name: {
          contains: query,
        },
      },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { id: "asc" },
    });

    res.json({
      query,
      count: customers.length,
      customers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 3. แสดงข้อมูลลูกค้าทุกคน (พร้อมรองรับ ?search=...)
// GET /api/customers
// ========================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const search = req.query.search || req.query.name;
    const whereClause = search
      ? {
          name: {
            contains: String(search).trim(),
          },
        }
      : {};

    const customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { orders: true } },
      },
      orderBy: { id: "desc" },
    });

    res.json({
      count: customers.length,
      customers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 4. ดูข้อมูลลูกค้ารายคนตาม ID
// GET /api/customers/:id
// ========================================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ error: `ไม่พบข้อมูลลูกค้า ID ${id}` });
    }

    res.json(customer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 5. เพิ่มลูกค้าใหม่
// POST /api/customers
// ========================================================
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, phone, addressDetail, latitude, longitude } = req.body;

    if (!name || !phone || !addressDetail || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        error: "กรุณาระบุข้อมูลให้ครบถ้วน: name, phone, addressDetail, latitude, longitude",
      });
    }

    const lat = parseFloat(String(latitude));
    const lng = parseFloat(String(longitude));

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "พิกัด latitude และ longitude ต้องเป็นตัวเลข" });
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name: String(name).trim(),
        phone: String(phone).trim(),
        addressDetail: String(addressDetail).trim(),
        latitude: lat,
        longitude: lng,
      },
    });

    res.status(201).json({
      message: "เพิ่มข้อมูลลูกค้าสำเร็จ",
      customer: newCustomer,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 6. แก้ไขข้อมูลลูกค้า
// PUT / PATCH /api/customers/:id
// ========================================================
const updateCustomerHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, phone, addressDetail, latitude, longitude } = req.body;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: `ไม่พบข้อมูลลูกค้า ID ${id}` });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (phone !== undefined) updateData.phone = String(phone).trim();
    if (addressDetail !== undefined) updateData.addressDetail = String(addressDetail).trim();
    if (latitude !== undefined) updateData.latitude = parseFloat(String(latitude));
    if (longitude !== undefined) updateData.longitude = parseFloat(String(longitude));

    const updated = await prisma.customer.update({
      where: { id },
      data: updateData,
    });

    res.json({
      message: "แก้ไขข้อมูลลูกค้าสำเร็จ",
      customer: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

router.put("/:id", updateCustomerHandler);
router.patch("/:id", updateCustomerHandler);

// ========================================================
// 7. ลบลูกค้า
// DELETE /api/customers/:id
// ========================================================
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.customer.findUnique({
      where: { id },
      include: { orders: true },
    });

    if (!existing) {
      return res.status(404).json({ error: `ไม่พบข้อมูลลูกค้า ID ${id}` });
    }

    // ล้าง task items ของออเดอร์ของลูกค้านี้ออกก่อน เพื่อความปลอดภัย
    const orderIds = (existing.orders as any[]).map((o: any) => o.id);
    if (orderIds.length > 0) {
      await prisma.taskItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.order.deleteMany({
        where: { customerId: id },
      });
    }

    await prisma.customer.delete({
      where: { id },
    });

    res.json({
      message: `ลบลูกค้า ${existing.name} (ID: ${id}) เรียบร้อยแล้ว`,
      deletedCustomerId: id,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
