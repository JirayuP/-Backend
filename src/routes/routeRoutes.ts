import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { VrpOptimizerService, ProposedTask } from "../services/vrpOptimizer";
import { QrService } from "../services/qrService";
import { BUSINESS_RULES } from "../constants";

const router = Router();

// 1. คำนวณจัดเส้นทางและแบ่งงานไรเดอร์ (Route Optimization)
router.post("/optimize", async (req: Request, res: Response) => {
  try {
    // ดึงออเดอร์ที่ยังไม่ได้จัดสรร (สถานะ PENDING)
    const pendingOrders = await prisma.order.findMany({
      where: { status: "PENDING" },
      include: { customer: true },
    });

    if (pendingOrders.length === 0) {
      return res.status(400).json({
        error: "ไม่มีออเดอร์สถานะ PENDING สำหรับจัดเส้นทาง",
      });
    }

    // คำนวณลำดับใบงานของวันนี้ เพื่อป้องกัน taskNumber ชนกัน
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const existingTasksToday = await prisma.deliveryTask.count({
      where: {
        createdAt: { gte: todayStart },
      },
    });

    // ประมวลผลด้วย VRP & TSP 2-Opt Algorithm
    const proposedTasks: ProposedTask[] = VrpOptimizerService.optimizeRoutes(
      pendingOrders as any,
      existingTasksToday + 1
    );

    // รวมสถิติภาพรวมทางการเงินและเวลา
    let totalRevenue = 0;
    let totalFoodCost = 0;
    let totalRiderFee = 0;
    let totalDistanceKm = 0;
    let totalBoxes = 0;
    let hasLateTask = false;

    proposedTasks.forEach((t) => {
      totalRevenue += t.totalRevenue;
      totalFoodCost += t.totalFoodCost;
      totalRiderFee += t.deliveryFee;
      totalDistanceKm += t.totalDistanceKm;
      totalBoxes += t.totalBoxes;
      if (t.isLate) hasLateTask = true;
    });

    const netProfit =
      Math.round((totalRevenue - totalFoodCost - totalRiderFee) * 100) / 100;

    res.json({
      summary: {
        totalOrders: pendingOrders.length,
        totalTasks: proposedTasks.length,
        totalBoxes,
        totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
        totalRevenue,
        totalFoodCost,
        totalRiderFee: Math.round(totalRiderFee * 100) / 100,
        netProfit,
        allDeliveredOnTime: !hasLateTask,
        departureTime: BUSINESS_RULES.DEPARTURE_TIME,
        deadlineTime: BUSINESS_RULES.DEADLINE_TIME,
      },
      hub: BUSINESS_RULES.HUB,
      tasks: proposedTasks,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ยืนยันการจัดงานและบันทึกลงฐานข้อมูล (Confirm & Dispatch)
router.post("/confirm", async (req: Request, res: Response) => {
  try {
    const { tasks }: { tasks: ProposedTask[] } = req.body;
    if (!tasks || tasks.length === 0) {
      return res.status(400).json({ error: "ไม่พบข้อมูล Task สำหรับยืนยัน" });
    }

    const savedTasks: any[] = [];

    // ดำเนินการบันทึกด้วย Transaction
    await prisma.$transaction(async (tx: any) => {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];

        // ตรวจสอบความซ้ำซ้อนของ taskNumber
        let uniqueTaskNumber = t.taskNumber;
        const existingTask = await tx.deliveryTask.findUnique({
          where: { taskNumber: uniqueTaskNumber },
        });

        if (existingTask) {
          const timestamp = Date.now().toString().slice(-4);
          uniqueTaskNumber = `${t.taskNumber}-${timestamp}-${i + 1}`;
        }

        // สร้าง DeliveryTask
        const taskRecord = await tx.deliveryTask.create({
          data: {
            taskNumber: uniqueTaskNumber,
            date: new Date(),
            departureTime: BUSINESS_RULES.DEPARTURE_TIME,
            totalDistance: t.totalDistanceKm,
            estimatedMinutes: t.estimatedMinutes,
            totalBoxes: t.totalBoxes,
            deliveryFee: t.deliveryFee,
            totalRevenue: t.totalRevenue,
            totalFoodCost: t.totalFoodCost,
            netProfit: t.netProfit,
            routeColor: t.routeColor,
            status: "CONFIRMED",
          },
        });

        // สร้าง TaskItem สำหรับแต่ละจุดส่ง และอัปเดตสถานะออเดอร์เป็น 'ASSIGNED'
        for (const stop of t.stops) {
          // ล้าง TaskItem เก่าของออเดอร์นี้ถ้ามีค้างอยู่
          await tx.taskItem.deleteMany({
            where: { orderId: stop.orderId },
          });

          await tx.taskItem.create({
            data: {
              taskId: taskRecord.id,
              orderId: stop.orderId,
              stopSequence: stop.stopSequence,
              estArrival: stop.estArrival,
              deliveryStatus: "PENDING",
            },
          });

          await tx.order.update({
            where: { id: stop.orderId },
            data: { status: "ASSIGNED" },
          });
        }

        savedTasks.push(taskRecord);
      }
    });

    res.status(201).json({
      message: `ยืนยันและปล่อยงานสำเร็จจำนวน ${savedTasks.length} ใบงาน`,
      tasks: savedTasks,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
