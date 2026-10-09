import { Router, Request, Response } from "express";
import { Prisma, DeliveryTask, TaskItem } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ProposedTask,
  RouteStrategy,
  VrpOptimizerService,
} from "../services/vrpOptimizer";
import { BUSINESS_RULES } from "../constants";

const router = Router();

const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_TRANSACTION_ATTEMPTS = 3;

type SavedTask = DeliveryTask & { items: TaskItem[] };

interface OptimizationSummary {
  totalOrders: number;
  totalTasks: number;
  totalBoxes: number;
  totalDistanceKm: number;
  totalRevenue: number;
  totalFoodCost: number;
  totalRiderFee: number;
  netProfit: number;
  allDeliveredOnTime: boolean;
  departureTime: string;
  deadlineTime: string;
}

const STRATEGY_METADATA: Readonly<
  Record<RouteStrategy, { label: string; description: string }>
> = {
  LOWEST_COST: {
    label: "ค่าจ้างต่ำสุด",
    description: "แบ่งงานตามต้นทุนรวมจริง โดยยังส่งทันเวลา",
  },
  FASTEST: {
    label: "ส่งเร็วสุด",
    description: "แยกหนึ่งออเดอร์ต่อไรเดอร์ เพื่อลดเวลาของแต่ละเส้นทาง",
  },
  FEWEST_RIDERS: {
    label: "ใช้ไรเดอร์น้อยสุด",
    description: `รวมงานสูงสุด ${BUSINESS_RULES.MAX_ORDERS_PER_RIDER} ออเดอร์ต่อไรเดอร์`,
  },
};

const ROUTE_STRATEGIES = Object.keys(STRATEGY_METADATA) as RouteStrategy[];

class RequestError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function getBangkokDayWindow(date: Date): { start: Date; end: Date } {
  const bangkokDate = new Date(date.getTime() + BANGKOK_UTC_OFFSET_MS);
  const startUtcMs =
    Date.UTC(
      bangkokDate.getUTCFullYear(),
      bangkokDate.getUTCMonth(),
      bangkokDate.getUTCDate()
    ) - BANGKOK_UTC_OFFSET_MS;
  return {
    start: new Date(startUtcMs),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000),
  };
}

function parseStrategy(value: unknown): RouteStrategy {
  if (value === undefined) return "LOWEST_COST";
  if (
    typeof value === "string" &&
    ROUTE_STRATEGIES.includes(value as RouteStrategy)
  ) {
    return value as RouteStrategy;
  }
  throw new RequestError(400, "Unknown route strategy");
}

function extractConfirmation(body: unknown): {
  orderIds: number[];
  strategy: RouteStrategy;
} {
  if (typeof body !== "object" || body === null || !("tasks" in body)) {
    throw new RequestError(400, "Request body must contain tasks");
  }

  const requestBody = body as { tasks?: unknown; strategy?: unknown };
  const tasks = requestBody.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new RequestError(400, "At least one task is required");
  }

  const orderIds: number[] = [];
  for (const task of tasks) {
    if (typeof task !== "object" || task === null || !("stops" in task)) {
      throw new RequestError(400, "Every task must contain stops");
    }

    const stops = (task as { stops?: unknown }).stops;
    if (
      !Array.isArray(stops) ||
      stops.length === 0 ||
      stops.length > BUSINESS_RULES.MAX_ORDERS_PER_RIDER
    ) {
      throw new RequestError(
        400,
        `Each task must contain 1-${BUSINESS_RULES.MAX_ORDERS_PER_RIDER} stops`
      );
    }

    for (const stop of stops) {
      if (typeof stop !== "object" || stop === null || !("orderId" in stop)) {
        throw new RequestError(400, "Every stop must contain orderId");
      }
      const orderId = (stop as { orderId?: unknown }).orderId;
      if (!Number.isSafeInteger(orderId) || Number(orderId) <= 0) {
        throw new RequestError(400, "orderId must be a positive integer");
      }
      orderIds.push(Number(orderId));
    }
  }

  if (new Set(orderIds).size !== orderIds.length) {
    throw new RequestError(400, "An order may appear in only one task");
  }
  return { orderIds, strategy: parseStrategy(requestBody.strategy) };
}

function summarize(
  tasks: readonly ProposedTask[],
  totalOrders: number
): OptimizationSummary {
  const totals = tasks.reduce(
    (summary, task) => ({
      totalBoxes: summary.totalBoxes + task.totalBoxes,
      totalDistanceKm: summary.totalDistanceKm + task.totalDistanceKm,
      totalRevenue: summary.totalRevenue + task.totalRevenue,
      totalFoodCost: summary.totalFoodCost + task.totalFoodCost,
      totalRiderFee: summary.totalRiderFee + task.deliveryFee,
      hasLateTask: summary.hasLateTask || task.isLate,
    }),
    {
      totalBoxes: 0,
      totalDistanceKm: 0,
      totalRevenue: 0,
      totalFoodCost: 0,
      totalRiderFee: 0,
      hasLateTask: false,
    }
  );

  return {
    totalOrders,
    totalTasks: tasks.length,
    totalBoxes: totals.totalBoxes,
    totalDistanceKm: Math.round(totals.totalDistanceKm * 100) / 100,
    totalRevenue: totals.totalRevenue,
    totalFoodCost: totals.totalFoodCost,
    totalRiderFee: Math.round(totals.totalRiderFee * 100) / 100,
    netProfit:
      Math.round(
        (totals.totalRevenue - totals.totalFoodCost - totals.totalRiderFee) * 100
      ) / 100,
    allDeliveredOnTime: !totals.hasLateTask,
    departureTime: BUSINESS_RULES.DEPARTURE_TIME,
    deadlineTime: BUSINESS_RULES.DEADLINE_TIME,
  };
}

function createResult(
  pendingOrders: Parameters<typeof VrpOptimizerService.optimizeRoutes>[0],
  startSequence: number,
  optimizationTime: Date,
  selectedStrategy: RouteStrategy
) {
  const alternatives = ROUTE_STRATEGIES.map((strategy) => {
    const tasks = VrpOptimizerService.optimizeRoutes(
      pendingOrders,
      startSequence,
      optimizationTime,
      strategy
    );
    return {
      strategy,
      ...STRATEGY_METADATA[strategy],
      summary: summarize(tasks, pendingOrders.length),
      tasks,
    };
  });
  const selected = alternatives.find(
    (alternative) => alternative.strategy === selectedStrategy
  );
  if (!selected) throw new Error("Selected route strategy was not generated");

  return {
    strategy: selected.strategy,
    strategyLabel: selected.label,
    summary: selected.summary,
    hub: BUSINESS_RULES.HUB,
    tasks: selected.tasks,
    alternatives,
  };
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

// โหลดใบงานที่ยืนยันแล้วของวันปัจจุบันกลับมาใช้หลังหน้าเจ้าของร้าน refresh
router.get("/today", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const dayWindow = getBangkokDayWindow(now);
    const savedTasks = await prisma.deliveryTask.findMany({
      where: {
        createdAt: { gte: dayWindow.start, lt: dayWindow.end },
        status: { in: ["CONFIRMED", "IN_PROGRESS", "DELIVERED"] },
      },
      include: {
        rider: true,
        items: {
          include: {
            order: { include: { customer: true } },
          },
          orderBy: { stopSequence: "asc" },
        },
      },
      orderBy: { id: "asc" },
    });

    const tasks = savedTasks.map((task) => {
      let previousPoint: { latitude: number; longitude: number } =
        BUSINESS_RULES.HUB;
      const stops = task.items.map((item) => {
        const destination = {
          latitude: item.order.customer.latitude,
          longitude: item.order.customer.longitude,
        };
        const distanceFromPrevKm =
          VrpOptimizerService.calculateHaversineDistance(
            previousPoint,
            destination
          );
        previousPoint = destination;

        return {
          itemId: item.id,
          orderId: item.orderId,
          stopSequence: item.stopSequence,
          customerName: item.order.customer.name,
          customerPhone: item.order.customer.phone,
          addressDetail: item.order.customer.addressDetail,
          latitude: destination.latitude,
          longitude: destination.longitude,
          boxAmount: item.order.boxAmount,
          itemPrice: item.order.totalPrice,
          distanceFromPrevKm,
          estArrival: item.estArrival ?? "-",
          deliveryStatus: item.deliveryStatus,
          navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            `${destination.latitude},${destination.longitude}`
          )}`,
        };
      });

      return {
        id: task.id,
        taskNumber: task.taskNumber,
        routeColor: task.routeColor,
        totalDistanceKm: task.totalDistance,
        estimatedMinutes: task.estimatedMinutes,
        totalBoxes: task.totalBoxes,
        deliveryFee: task.deliveryFee,
        totalRevenue: task.totalRevenue,
        totalFoodCost: task.totalFoodCost,
        netProfit: task.netProfit,
        isLate: task.estimatedMinutes > BUSINESS_RULES.MAX_ALLOWED_MINUTES,
        status: task.status,
        rider: task.rider
          ? {
              name: task.rider.name,
              phone: task.rider.phone,
              vehiclePlate: task.rider.vehiclePlate,
            }
          : null,
        stops,
        waypoints: [
          [BUSINESS_RULES.HUB.latitude, BUSINESS_RULES.HUB.longitude] as [
            number,
            number,
          ],
          ...stops.map(
            (stop) => [stop.latitude, stop.longitude] as [number, number]
          ),
        ],
      };
    });

    return res.json({
      strategy: "LOWEST_COST" as const,
      strategyLabel: "ใบงานที่ปล่อยแล้ววันนี้",
      summary: summarize(tasks, tasks.reduce((sum, task) => sum + task.stops.length, 0)),
      hub: BUSINESS_RULES.HUB,
      tasks,
      alternatives: [],
    });
  } catch (error: unknown) {
    return res.status(500).json({ error: getErrorMessage(error) });
  }
});

async function saveAuthoritativeTasks(
  orderIds: readonly number[],
  strategy: RouteStrategy,
  now: Date
): Promise<{ savedTasks: SavedTask[]; calculatedTasks: ProposedTask[] }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const pendingOrders = await tx.order.findMany({
            where: { id: { in: [...orderIds] }, status: "PENDING" },
            include: { customer: true },
          });

          if (pendingOrders.length !== orderIds.length) {
            throw new RequestError(
              409,
              "Some orders are no longer pending. Run optimization again."
            );
          }

          // Claim every order atomically. A stale/concurrent confirmation must
          // never delete or reassign an existing TaskItem.
          const claimed = await tx.order.updateMany({
            where: { id: { in: [...orderIds] }, status: "PENDING" },
            data: { status: "ASSIGNED" },
          });
          if (claimed.count !== orderIds.length) {
            throw new RequestError(
              409,
              "Orders were assigned by another request. Run optimization again."
            );
          }

          const dayWindow = getBangkokDayWindow(now);
          const existingTasksToday = await tx.deliveryTask.count({
            where: {
              createdAt: { gte: dayWindow.start, lt: dayWindow.end },
            },
          });
          const calculatedTasks = VrpOptimizerService.optimizeRoutes(
            pendingOrders,
            existingTasksToday + 1,
            now,
            strategy
          );

          // The SLA is authoritative: never persist a plan whose final stop
          // (including service time) finishes after 12:30.
          if (calculatedTasks.some((task) => task.isLate)) {
            throw new RequestError(
              422,
              "The selected plan cannot deliver every order by 12:30"
            );
          }
          const savedTasks: SavedTask[] = [];

          for (const task of calculatedTasks) {
            const taskRecord = await tx.deliveryTask.create({
              data: {
                taskNumber: task.taskNumber,
                date: now,
                departureTime: BUSINESS_RULES.DEPARTURE_TIME,
                totalDistance: task.totalDistanceKm,
                estimatedMinutes: task.estimatedMinutes,
                totalBoxes: task.totalBoxes,
                deliveryFee: task.deliveryFee,
                totalRevenue: task.totalRevenue,
                totalFoodCost: task.totalFoodCost,
                netProfit: task.netProfit,
                routeColor: task.routeColor,
                status: "CONFIRMED",
                items: {
                  create: task.stops.map((stop) => ({
                    orderId: stop.orderId,
                    stopSequence: stop.stopSequence,
                    estArrival: stop.estArrival,
                    deliveryStatus: "PENDING",
                  })),
                },
              },
              include: { items: true },
            });
            savedTasks.push(taskRecord);
          }

          return { savedTasks, calculatedTasks };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 15_000,
          timeout: 60_000,
        }
      );
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw lastError;
}

// 1. คำนวณจัดเส้นทางและแบ่งงานไรเดอร์ (Route Optimization)
router.post("/optimize", async (_req: Request, res: Response) => {
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
    const optimizationTime = new Date();
    const dayWindow = getBangkokDayWindow(optimizationTime);
    const existingTasksToday = await prisma.deliveryTask.count({
      where: {
        createdAt: { gte: dayWindow.start, lt: dayWindow.end },
      },
    });

    // ประมวลผลด้วย VRP & TSP 2-Opt Algorithm
    return res.json(
      createResult(
        pendingOrders,
        existingTasksToday + 1,
        optimizationTime,
        "LOWEST_COST"
      )
    );
  } catch (error: unknown) {
    const statusCode =
      error instanceof RequestError
        ? error.statusCode
        : error instanceof RangeError
          ? 422
          : 500;
    return res.status(statusCode).json({ error: getErrorMessage(error) });
  }
});

// 2. ยืนยันการจัดงานและบันทึกลงฐานข้อมูล (Confirm & Dispatch)
router.post("/confirm", async (req: Request, res: Response) => {
  try {
    const { orderIds, strategy } = extractConfirmation(req.body);
    const now = new Date();
    const { savedTasks, calculatedTasks } = await saveAuthoritativeTasks(
      orderIds,
      strategy,
      now
    );

    const confirmedTasks = calculatedTasks.map((task, index) => ({
      ...task,
      id: savedTasks[index].id,
      taskNumber: savedTasks[index].taskNumber,
    }));

    const metadata = STRATEGY_METADATA[strategy];
    return res.status(201).json({
      message: `Confirmed and dispatched ${savedTasks.length} tasks`,
      result: {
        strategy,
        strategyLabel: metadata.label,
        summary: summarize(confirmedTasks, orderIds.length),
        hub: BUSINESS_RULES.HUB,
        tasks: confirmedTasks,
        alternatives: [],
      },
    });
  } catch (error: unknown) {
    console.error("Error in /confirm:", error);
    const statusCode =
      error instanceof RequestError
        ? error.statusCode
        : error instanceof RangeError
          ? 422
          : 500;
    return res.status(statusCode).json({ error: getErrorMessage(error) });
  }
});

export default router;
