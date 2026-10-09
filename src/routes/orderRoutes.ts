import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { BUSINESS_RULES } from "../constants";
import { calculateStraightDistanceKm } from "../utils/geo";

const router = Router();

// ========================================================
// 1. แสดงรายการสั่งซื้อทั้งหมดในระยะทางที่กำหนด (เช่น 2 กิโลเมตร จากพิกัดที่กำหนด)
// GET /api/orders/nearby?lat=16.246825&lng=103.252072&radius=2
// ========================================================
router.get("/nearby", async (req: Request, res: Response) => {
  try {
    const hub = BUSINESS_RULES.HUB;
    const centerLat = req.query.lat ? parseFloat(String(req.query.lat)) : hub.latitude;
    const centerLng = req.query.lng ? parseFloat(String(req.query.lng)) : hub.longitude;
    const radiusKm = req.query.radius ? parseFloat(String(req.query.radius)) : 2.0;

    if (isNaN(centerLat) || isNaN(centerLng) || isNaN(radiusKm)) {
      return res.status(400).json({ error: "พิกัด lat, lng หรือ radius ไม่ถูกต้อง" });
    }

    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        taskItem: {
          include: {
            task: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const nearbyOrders = (orders as any[])
      .map((order: any) => {
        const distanceKm = calculateStraightDistanceKm(
          { latitude: centerLat, longitude: centerLng },
          { latitude: order.customer.latitude, longitude: order.customer.longitude }
        );
        return {
          ...order,
          distanceKm,
        };
      })
      .filter((order: any) => order.distanceKm <= radiusKm)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm);

    res.json({
      center: { latitude: centerLat, longitude: centerLng },
      radiusKm,
      count: nearbyOrders.length,
      orders: nearbyOrders,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 2. ดึงรายการออเดอร์ทั้งหมด พร้อมข้อมูลลูกค้า
// GET /api/orders
// ========================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const whereClause = status ? { status } : {};

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        customer: true,
        taskItem: {
          include: {
            task: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 3. ดูรายละเอียดออเดอร์ราย ID
// GET /api/orders/:id
// ========================================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        taskItem: {
          include: { task: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: `ไม่พบออเดอร์ ID ${id}` });
    }

    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 4. เพิ่มรายการสั่งซื้อใหม่
// POST /api/orders
// ========================================================
router.post("/", async (req: Request, res: Response) => {
  try {
    const { customerId, boxAmount } = req.body;
    const numBoxes = Number(boxAmount);

    if (!customerId || isNaN(numBoxes) || numBoxes < 1 || numBoxes > 3) {
      return res.status(400).json({
        error: "กรุณาระบุ customerId และจำนวนกล่อง (boxAmount) ระหว่าง 1 ถึง 3 กล่อง",
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: Number(customerId) },
    });
    if (!customer) {
      return res.status(404).json({ error: `ไม่พบข้อมูลลูกค้า ID ${customerId}` });
    }

    const order = await prisma.order.create({
      data: {
        customerId: Number(customerId),
        boxAmount: numBoxes,
        totalPrice: numBoxes * BUSINESS_RULES.PRICE_PER_BOX,
        status: "PENDING",
      },
      include: { customer: true },
    });

    res.status(201).json({
      message: "สร้างรายการสั่งซื้อสำเร็จ",
      order,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 5. แก้ไขจำนวนกล่องในออเดอร์ (คำนวณราคารวมใหม่อัตโนมัติ)
// PATCH / PUT /api/orders/:id
// ========================================================
const updateOrderHandler = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { boxAmount, status } = req.body;

    const existingOrder = await prisma.order.findUnique({
      where: { id },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: `ไม่พบออเดอร์ ID ${id}` });
    }

    const updateData: any = {};

    if (boxAmount !== undefined) {
      const numBoxes = Number(boxAmount);
      if (isNaN(numBoxes) || numBoxes < 1 || numBoxes > 3) {
        return res.status(400).json({
          error: "จำนวนกล่องต้องอยู่ระหว่าง 1 ถึง 3 กล่อง",
        });
      }
      updateData.boxAmount = numBoxes;
      updateData.totalPrice = numBoxes * BUSINESS_RULES.PRICE_PER_BOX;
    }

    if (status !== undefined) {
      updateData.status = String(status).toUpperCase();
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
      include: { customer: true },
    });

    res.json({
      message: `แก้ไขออเดอร์ ID ${id} เรียบร้อยแล้ว (จำนวนกล่อง: ${updatedOrder.boxAmount}, ราคารวม: ${updatedOrder.totalPrice} บาท)`,
      order: updatedOrder,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

router.patch("/:id", updateOrderHandler);
router.put("/:id", updateOrderHandler);

// ========================================================
// 6. ลบออเดอร์รายรายการ
// DELETE /api/orders/:id
// ========================================================
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: `ไม่พบออเดอร์ ID ${id}` });
    }

    await prisma.taskItem.deleteMany({
      where: { orderId: id },
    });
    await prisma.order.delete({
      where: { id },
    });

    res.json({ message: `ลบออเดอร์ ID ${id} สำเร็จ` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 7. ล้าง(ลบทั้งหมด) รายการสั่งซื้อและใบงานทั้งหมด
// DELETE /api/orders
// ========================================================
router.delete("/", async (req: Request, res: Response) => {
  try {
    const deletedItems = await prisma.taskItem.deleteMany();
    const deletedTasks = await prisma.deliveryTask.deleteMany();
    const deletedOrders = await prisma.order.deleteMany();

    res.json({
      message: "ล้างข้อมูลรายการสั่งซื้อและใบงานทั้งหมดเรียบร้อยแล้ว",
      deletedCounts: {
        taskItems: deletedItems.count,
        deliveryTasks: deletedTasks.count,
        orders: deletedOrders.count,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 8. จำลองรายการสั่งซื้อ 20-30 รายการ พร้อมข้อมูลลูกค้าครบถ้วน
// POST /api/orders/seed?count=25
// ========================================================
router.post("/seed", async (req: Request, res: Response) => {
  try {
    // ล้างข้อมูลออเดอร์และใบงานเก่า
    await prisma.taskItem.deleteMany();
    await prisma.deliveryTask.deleteMany();
    await prisma.order.deleteMany();

    const hub = BUSINESS_RULES.HUB;

    // รายชื่อลูกค้าจำลอง 30 คน ครอบคลุมหอพัก-คณะต่างๆ รอบ มมส. ขามเรียง ในรัศมี 0.5 - 2.8 กม.
    const mockCustomerDatabase = [
      { name: "น้องพลอย ศิริพร (วิทยาการสารสนเทศ)", phone: "081-234-5601", address: "หอพักเสริมไทย คอมเพล็กซ์ ชั้น 3 ห้อง 305", dLat: 0.0055, dLon: 0.0042 },
      { name: "พี่บิ๊ก วรวิทย์ (วิศวกรรมศาสตร์)", phone: "082-345-6702", address: "หอพักกิตติภูมิ ซอยวุ่นวาย ห้อง 412", dLat: -0.0042, dLon: 0.0031 },
      { name: "อาจารย์กานต์ ธีระศักดิ์ (ศึกษาศาสตร์)", phone: "083-456-7803", address: "อาคารเรียนรวม มมส. เขตขามเรียง ชั้น 2", dLat: 0.0021, dLon: -0.0034 },
      { name: "น้องน้ำมนต์ พิชญา (เภสัชศาสตร์)", phone: "084-567-8904", address: "หอพักบุญช่วย หลังมอ ขามเรียง", dLat: 0.0082, dLon: 0.0025 },
      { name: "พี่ก้อง ธนกฤต (การบัญชี)", phone: "085-678-9005", address: "คอนโดสุขใจ หน้า มมส. ห้อง 501", dLat: -0.0035, dLon: -0.0043 },
      { name: "น้องมิ้นท์ วริศรา (สาธารณสุขศาสตร์)", phone: "086-789-0106", address: "หอพักสบันงา ประตูดวงเวียงจันทน์", dLat: 0.0068, dLon: -0.0032 },
      { name: "หมอเต้ย ณภัทร (พยาบาลศาสตร์)", phone: "087-890-1207", address: "หออินเตอร์ มมส. อาคาร 2 ห้อง 215", dLat: 0.0035, dLon: 0.0062 },
      { name: "พี่อาร์ม ปริญญา (นิติศาสตร์)", phone: "088-901-2308", address: "หอพักศรีสวัสดิ์ ซอย 7 ท่าขอนยาง", dLat: -0.0075, dLon: 0.0018 },
      { name: "น้องเฟิร์น ชนิกานต์ (มนุษยศาสตร์)", phone: "089-012-3409", address: "หอพักลลิตา ขามเรียง ห้อง 108", dLat: -0.0058, dLon: -0.0051 },
      { name: "ป้าสมศรี เจริญพร (เจ้าหน้าที่กองคลัง)", phone: "090-123-4510", address: "อาคารบรมราชกุมารี (ตึกอธิการบดี)", dLat: 0.0012, dLon: 0.0015 },
      { name: "น้องกันต์ ชลวิทย์ (สถาปัตยกรรมศาสตร์)", phone: "091-234-5611", address: "หอพักศิลป์ ครีเอทีฟ ซอย 10", dLat: 0.0095, dLon: -0.0045 },
      { name: "น้องแพรว สุภาพร (แพทยศาสตร์)", phone: "092-345-6712", address: "หอพักแพทย์ มมส. หน้า รพ.สุทธาเวช", dLat: -0.0085, dLon: 0.0062 },
      { name: "พี่เจมส์ อัครเดช (วิทยาศาสตร์)", phone: "093-456-7813", address: "แล็บเคมี อาคาร SC2 ชั้น 3", dLat: 0.0042, dLon: 0.0048 },
      { name: "น้องกล้วย กัญญารัตน์ (การท่องเที่ยว)", phone: "094-567-8914", address: "หอพักธนสาร ท่าขอนยาง ซอย 2", dLat: -0.0092, dLon: -0.0035 },
      { name: "พี่เอก ภานุวัฒน์ (สิ่งแวดล้อม)", phone: "095-678-9015", address: "อาคารปฏิบัติการ คณะสิ่งแวดล้อม", dLat: 0.0051, dLon: -0.0072 },
      { name: "น้องฟ้า อลิสา (เทคโนโลยี)", phone: "096-789-0116", address: "หอพักยูพาร์ค ขามเรียง อาคาร A", dLat: -0.0025, dLon: 0.0084 },
      { name: "น้องแบงค์ ธีรภัทร (ดุริยางคศิลป์)", phone: "097-890-1217", address: "หอพักเสียงทอง ซอยวุ่นวาย", dLat: -0.0069, dLon: 0.0035 },
      { name: "พี่ยุ้ย ศิริรัตน์ (วิทยาศาสตร์การกีฬา)", phone: "098-901-2318", address: "ศูนย์กีฬา มมส. สนามฟุตบอล 1", dLat: 0.0022, dLon: -0.0068 },
      { name: "น้องเบลล์ รพีพร (รัฐศาสตร์)", phone: "099-012-3419", address: "หอพักมังกรทอง ท่าขอนยาง", dLat: -0.0105, dLon: -0.0008 },
      { name: "ช่างเปี๊ยก สมหมาย (ศูนย์ไอที)", phone: "081-111-2220", address: "อาคารศูนย์คอมพิวเตอร์ มมส. ห้องเซอร์เวอร์", dLat: 0.0028, dLon: 0.0009 },
      { name: "พี่ต้อม ธนากร (สัตวแพทยศาสตร์)", phone: "082-222-3321", address: "โรงพยาบาลสัตว์ มมส. แผนกฉุกเฉิน", dLat: 0.0081, dLon: 0.0058 },
      { name: "น้องตั๊ก อรอุมา (สถาบันติวเตอร์)", phone: "083-333-4422", address: "สถาบันกวดวิชาหน้าป้าย มมส. ชั้น 2", dLat: -0.0035, dLon: -0.0018 },
      { name: "พี่แมน นรินทร์ (การจัดการ)", phone: "084-444-5523", address: "หอพักแกรนด์วิลล์ ขามเรียง", dLat: 0.0061, dLon: 0.0075 },
      { name: "น้องเมย์ ปวีณา (เศรษฐศาสตร์)", phone: "085-555-6624", address: "คอนโดกรีนปาร์ค หน้า มมส.", dLat: -0.0048, dLon: 0.0082 },
      { name: "พี่ท็อป สหรัฐ (โลจิสติกส์)", phone: "086-666-7725", address: "หอพักร่มเย็น ซอย 5", dLat: 0.0077, dLon: -0.0055 },
      { name: "น้องแป้ง กัลยกร (นิเทศศาสตร์)", phone: "087-777-8826", address: "สตูดิโอถ่ายทำ คณะวิทยาการสารสนเทศ", dLat: 0.0045, dLon: -0.0022 },
      { name: "พี่ยุทธ พิชิตชัย (เกษตรศาสตร์)", phone: "088-888-9927", address: "แปลงทดลองการเกษตร มมส.", dLat: -0.0118, dLon: -0.0042 },
      { name: "น้องวิว ชญานิษฐ์ (ศิลปกรรมศาสตร์)", phone: "089-999-0028", address: "หอพักพราวสไตล์ ขามเรียง", dLat: 0.0089, dLon: -0.0015 },
      { name: "พี่นนท์ รัชชานนท์ (สังคมสงเคราะห์)", phone: "090-000-1129", address: "อาคารกิจกรรมนักศึกษา มมส.", dLat: -0.0015, dLon: 0.0038 },
      { name: "น้องเกด วรัญญา (เทคโนโลยีการอาหาร)", phone: "091-111-2230", address: "โรงประลองแปรรูปอาหาร คณะเทคโนโลยี", dLat: -0.0052, dLon: 0.0095 },
    ];

    // สุ่มจำนวนรายการ 20-30 รายการ (หรือรับจาก ?count=...)
    let targetCount = req.query.count ? parseInt(String(req.query.count)) : 0;
    if (isNaN(targetCount) || targetCount < 20 || targetCount > 30) {
      // สุ่มระหว่าง 20 ถึง 30 รายการ
      targetCount = Math.floor(Math.random() * 11) + 20; // 20 .. 30
    }

    // สับเปลี่ยนลำดับ (Shuffle) และเลือกมาตามจำนวนที่ต้องการ
    const shuffledList = [...mockCustomerDatabase]
      .sort(() => Math.random() - 0.5)
      .slice(0, targetCount);

    const createdOrders: any[] = [];

    for (const item of shuffledList) {
      // ค้นหาหรือสร้างลูกค้า
      let customer = await prisma.customer.findFirst({
        where: { phone: item.phone },
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            name: item.name,
            phone: item.phone,
            addressDetail: item.address,
            latitude: hub.latitude + item.dLat,
            longitude: hub.longitude + item.dLon,
          },
        });
      }

      // สุ่มจำนวนกล่อง 1 - 3 กล่อง ตามโจทย์
      const boxAmount = Math.floor(Math.random() * 3) + 1;
      const order = await prisma.order.create({
        data: {
          customerId: customer.id,
          boxAmount,
          totalPrice: boxAmount * BUSINESS_RULES.PRICE_PER_BOX,
          status: "PENDING",
        },
        include: { customer: true },
      });

      createdOrders.push(order);
    }

    res.status(201).json({
      message: `จำลองออเดอร์สำเร็จจำนวน ${createdOrders.length} รายการ (20-30 รายการตามโจทย์)`,
      count: createdOrders.length,
      orders: createdOrders,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
