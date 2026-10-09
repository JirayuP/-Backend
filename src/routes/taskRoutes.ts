import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { QrService } from "../services/qrService";

const router = Router();

// 1. ดึงรายการ Tasks ทั้งหมด
router.get("/", async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.deliveryTask.findMany({
      include: {
        rider: true,
        items: {
          include: {
            order: {
              include: { customer: true },
            },
          },
          orderBy: { stopSequence: "asc" },
        },
      },
      orderBy: { id: "desc" },
    });
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ดึงรายละเอียดใบงานสำหรับไรเดอร์ (เปิดดูผ่านมือถือด้วย Task Number)
router.get("/:taskNumber", async (req: Request, res: Response) => {
  try {
    const taskNumber = String(req.params.taskNumber);
    const task = await prisma.deliveryTask.findUnique({
      where: { taskNumber },
      include: {
        rider: true,
        items: {
          include: {
            order: {
              include: { customer: true },
            },
          },
          orderBy: { stopSequence: "asc" },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: `ไม่พบใบงานรหัส ${taskNumber}` });
    }

    // จัดรูปแบบข้อมูลเพื่อให้หน้าจอไรเดอร์ใช้งานง่ายที่สุด
    // กฎความปลอดภัย: ถ้าคนขับยังไม่ลงชื่อรับงาน จะยังไม่แสดงรายการจุดส่ง (stops: [])
    const hasRider = Boolean(task.rider);
    const formattedTask = {
      id: task.id,
      taskNumber: task.taskNumber,
      departureTime: task.departureTime,
      totalBoxes: task.totalBoxes,
      totalDistance: task.totalDistance,
      estimatedMinutes: task.estimatedMinutes,
      deliveryFee: task.deliveryFee,
      status: task.status,
      routeColor: task.routeColor,
      rider: task.rider,
      totalStopsCount: task.items.length,
      stops: hasRider
        ? task.items.map((item) => ({
            itemId: item.id,
            orderId: item.orderId,
            stopSequence: item.stopSequence,
            customerName: item.order.customer.name,
            customerPhone: item.order.customer.phone,
            addressDetail: item.order.customer.addressDetail,
            latitude: item.order.customer.latitude,
            longitude: item.order.customer.longitude,
            boxAmount: item.order.boxAmount,
            estArrival: item.estArrival,
            deliveryStatus: item.deliveryStatus,
            navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${item.order.customer.latitude},${item.order.customer.longitude}`,
          }))
        : [],
    };

    res.json(formattedTask);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. สร้างรูป QR Code สำหรับสแกนเข้าสู่ใบงานนี้
router.get("/:taskNumber/qr", async (req: Request, res: Response) => {
  try {
    const taskNumber = String(req.params.taskNumber);
    const qrDataUrl = await QrService.generateTaskQrCode(taskNumber);
    res.json({
      taskNumber,
      qrDataUrl,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. ไรเดอร์ลงทะเบียนรับงานแบบด่วน (Quick Check-in ไม่ต้องล็อกอิน)
router.post("/:taskNumber/checkin", async (req: Request, res: Response) => {
  try {
    const taskNumber = String(req.params.taskNumber);
    const { riderName, riderPhone, vehiclePlate } = req.body;

    if (!riderName || !riderPhone) {
      return res.status(400).json({ error: "กรุณาระบุชื่อและเบอร์โทรไรเดอร์" });
    }

    const taskExists = await prisma.deliveryTask.findUnique({
      where: { taskNumber },
    });
    if (!taskExists) {
      return res.status(404).json({ error: `ไม่พบใบงาน ${taskNumber}` });
    }

    // ค้นหาหรือสร้างไรเดอร์
    let rider = await prisma.rider.findFirst({
      where: { phone: riderPhone },
    });

    if (!rider) {
      rider = await prisma.rider.create({
        data: {
          name: riderName,
          phone: riderPhone,
          vehiclePlate: vehiclePlate || "มอเตอร์ไซค์",
          status: "ON_DUTY",
        },
      });
    }

    // ผูกไรเดอร์เข้ากับ Task
    const updatedTask = await prisma.deliveryTask.update({
      where: { taskNumber },
      data: {
        riderId: rider.id,
        status: "IN_PROGRESS",
      },
      include: { rider: true },
    });

    res.json({
      message: `ไรเดอร์ ${rider.name} รับใบงาน ${taskNumber} เรียบร้อย`,
      task: updatedTask,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ไรเดอร์กดยืนยันส่งมอบสำเร็จในแต่ละจุดส่ง
router.patch(
  "/:taskNumber/stops/:itemId/complete",
  async (req: Request, res: Response) => {
    try {
      const { taskNumber, itemId } = req.params;
      const numItemId = Number(itemId);

      const existingItem = await prisma.taskItem.findUnique({
        where: { id: numItemId },
        include: { task: true },
      });

      if (!existingItem) {
        return res.status(404).json({ error: "ไม่พบรายการจุดส่งนี้" });
      }

      if (!existingItem.task.riderId) {
        return res.status(400).json({ error: "กรุณาลงชื่อรับใบงานก่อน จึงจะสามารถยืนยันส่งมอบได้" });
      }

      const item = await prisma.taskItem.update({
        where: { id: numItemId },
        data: {
          deliveryStatus: "DELIVERED",
          actualArrival: new Date(),
        },
        include: { task: true },
      });

      // อัปเดตสถานะออเดอร์
      await prisma.order.update({
        where: { id: item.orderId },
        data: { status: "DELIVERED" },
      });

      // ตรวจสอบว่าส่งครบทุกจุดใน Task นี้แล้วหรือยัง
      const remainingStops = await prisma.taskItem.count({
        where: {
          taskId: item.taskId,
          deliveryStatus: "PENDING",
        },
      });

      if (remainingStops === 0) {
        await prisma.deliveryTask.update({
          where: { id: item.taskId },
          data: { status: "DELIVERED" },
        });
      }

      res.json({
        message: `จุดส่งที่ ${item.stopSequence} จัดส่งสำเร็จเรียบร้อย`,
        item,
        isTaskCompleted: remainingStops === 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 6. อัปเดตสถานะของ Task
router.patch("/:taskNumber/status", async (req: Request, res: Response) => {
  try {
    const taskNumber = String(req.params.taskNumber);
    const { status } = req.body;

    const task = await prisma.deliveryTask.update({
      where: { taskNumber },
      data: { status },
    });

    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
