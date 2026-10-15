import { BUSINESS_RULES } from "../constants";

const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;
const ROAD_DISTANCE_FACTOR = 1.25;

export type RouteStrategy =
  | "LOWEST_COST"
  | "FASTEST"
  | "FEWEST_RIDERS";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PendingOrder {
  id: number;
  boxAmount: number;
  totalPrice: number;
  customer: {
    id: number;
    name: string;
    phone: string;
    addressDetail: string;
    latitude: number;
    longitude: number;
  };
}

export interface OptimizedStop {
  orderId: number;
  stopSequence: number;
  customerName: string;
  customerPhone: string;
  addressDetail: string;
  latitude: number;
  longitude: number;
  boxAmount: number;
  itemPrice: number;
  distanceFromPrevKm: number;
  estArrival: string;
  navigationUrl: string;
}

export interface ProposedTask {
  taskNumber: string;
  routeColor: string;
  totalDistanceKm: number;
  estimatedMinutes: number;
  totalBoxes: number;
  deliveryFee: number;
  totalRevenue: number;
  totalFoodCost: number;
  netProfit: number;
  isLate: boolean;
  stops: OptimizedStop[];
  waypoints: [number, number][];
}

interface PartitionCandidate {
  clusters: PendingOrder[][];
  lateTaskCount: number;
  deliveryFee: number;
  totalDistanceKm: number;
  maxEstimatedMinutes: number;
}

// ปัดค่าตัวเลขเป็นทศนิยมสองตำแหน่ง
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// แปลงวันที่เป็นรหัส YYYYMMDD ตามเวลาไทย
export function formatBangkokDateKey(date: Date = new Date()): string {
  const bangkokDate = new Date(date.getTime() + BANGKOK_UTC_OFFSET_MS);
  const year = bangkokDate.getUTCFullYear();
  const month = String(bangkokDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(bangkokDate.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export class VrpOptimizerService {
  // คำนวณระยะทางเส้นตรงระหว่างสองพิกัด
  public static calculateStraightDistanceKm(
    p1: GeoPoint,
    p2: GeoPoint
  ): number {
    return roundMoney(this.calculateGreatCircleDistanceKm(p1, p2));
  }

  // คำนวณระยะทางถนนโดยประมาณระหว่างสองพิกัด
  public static calculateHaversineDistance(
    p1: GeoPoint,
    p2: GeoPoint
  ): number {
    return roundMoney(this.calculateRoadDistanceKm(p1, p2));
  }

  // คำนวณระยะทางบนผิวโลกด้วยสูตรวงกลมใหญ่
  private static calculateGreatCircleDistanceKm(
    p1: GeoPoint,
    p2: GeoPoint
  ): number {
    const dLat = this.deg2rad(p2.latitude - p1.latitude);
    const dLon = this.deg2rad(p2.longitude - p1.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.deg2rad(p1.latitude)) *
        Math.cos(this.deg2rad(p2.latitude)) *
        Math.sin(dLon / 2) ** 2;
    const clampedA = Math.min(1, Math.max(0, a));
    const centralAngle =
      2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
    return EARTH_RADIUS_KM * centralAngle;
  }

  // ปรับระยะทางเส้นตรงให้เป็นระยะทางถนนโดยประมาณ
  private static calculateRoadDistanceKm(
    p1: GeoPoint,
    p2: GeoPoint
  ): number {
    return (
      this.calculateGreatCircleDistanceKm(p1, p2) * ROAD_DISTANCE_FACTOR
    );
  }

  // แปลงหน่วยองศาเป็นเรเดียน
  private static deg2rad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // คำนวณมุมของจุดส่งเทียบกับศูนย์กลาง
  private static calculateAngleFromHub(point: GeoPoint): number {
    const hub = BUSINESS_RULES.HUB;
    const angle = Math.atan2(
      point.latitude - hub.latitude,
      point.longitude - hub.longitude
    );
    return angle < 0 ? angle + 2 * Math.PI : angle;
  }

  // เรียงออเดอร์ตามมุมรอบศูนย์กลางเพื่อจัดกลุ่มเส้นทาง
  private static sortOrdersForCircularSweep(
    orders: readonly PendingOrder[]
  ): PendingOrder[] {
    const sorted = [...orders].sort((a, b) => {
      const angleDifference =
        this.calculateAngleFromHub(a.customer) -
        this.calculateAngleFromHub(b.customer);
      return angleDifference !== 0 ? angleDifference : a.id - b.id;
    });

    if (sorted.length <= 1) return sorted;

    let largestGap = -1;
    let startIndex = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const nextIndex = (index + 1) % sorted.length;
      const currentAngle = this.calculateAngleFromHub(
        sorted[index].customer
      );
      const nextAngle = this.calculateAngleFromHub(
        sorted[nextIndex].customer
      );
      const gap =
        nextIndex === 0
          ? nextAngle + 2 * Math.PI - currentAngle
          : nextAngle - currentAngle;

      if (gap > largestGap) {
        largestGap = gap;
        startIndex = nextIndex;
      }
    }

    return [...sorted.slice(startIndex), ...sorted.slice(0, startIndex)];
  }

  // ตรวจสอบความถูกต้องและขอบเขตบริการของออเดอร์
  private static assertValidOrders(
    orders: readonly PendingOrder[]
  ): void {
    const seenIds = new Set<number>();
    for (const order of orders) {
      const valid =
        Number.isSafeInteger(order.id) &&
        order.id > 0 &&
        !seenIds.has(order.id) &&
        Number.isInteger(order.boxAmount) &&
        order.boxAmount >= 1 &&
        order.boxAmount <= 3 &&
        Number.isFinite(order.totalPrice) &&
        Number.isFinite(order.customer.latitude) &&
        order.customer.latitude >= -90 &&
        order.customer.latitude <= 90 &&
        Number.isFinite(order.customer.longitude) &&
        order.customer.longitude >= -180 &&
        order.customer.longitude <= 180;

      if (!valid) {
        throw new TypeError(
          `ข้อมูลออเดอร์ ID ${String(order.id)} ไม่ถูกต้อง`
        );
      }

      const distanceFromHub = this.calculateGreatCircleDistanceKm(
        BUSINESS_RULES.HUB,
        order.customer
      );
      if (distanceFromHub > BUSINESS_RULES.HUB.radiusKm) {
        throw new RangeError(
          `ออเดอร์ ID ${order.id} อยู่นอกรัศมีบริการ ${BUSINESS_RULES.HUB.radiusKm} กม.`
        );
      }
      seenIds.add(order.id);
    }
  }

  // เพิ่มนาทีและจัดรูปแบบเวลาเป็น HH:mm
  private static formatTime(
    baseTime: string,
    addMinutes: number
  ): string {
    const [hours, minutes] = baseTime.split(":").map(Number);
    const totalMinutes =
      hours * 60 + minutes + Math.ceil(addMinutes - Number.EPSILON);
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
      normalized % 60
    ).padStart(2, "0")}`;
  }

  // สร้างลิงก์นำทาง Google Maps ไปยังจุดส่ง
  private static createNavigationUrl(
    latitude: number,
    longitude: number
  ): string {
    const destination = encodeURIComponent(`${latitude},${longitude}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  }

  // จัดกลุ่มและคำนวณเส้นทางจัดส่งตามกลยุทธ์ที่เลือก
  public static optimizeRoutes(
    orders: readonly PendingOrder[],
    startSequence = 1,
    optimizationDate: Date = new Date(),
    strategy: RouteStrategy = "LOWEST_COST"
  ): ProposedTask[] {
    if (orders.length === 0) return [];
    if (!Number.isSafeInteger(startSequence) || startSequence < 1) {
      throw new RangeError("startSequence must be a positive integer");
    }

    this.assertValidOrders(orders);
    const sortedOrders = this.sortOrdersForCircularSweep(orders);
    const clusters = this.partitionOrders(
      sortedOrders,
      strategy,
      optimizationDate
    );

    return clusters.map((cluster, index) =>
      this.buildTask(
        cluster,
        startSequence + index,
        index,
        optimizationDate
      )
    );
  }

  // แบ่งออเดอร์เป็นกลุ่มงานตามกลยุทธ์
  private static partitionOrders(
    orders: readonly PendingOrder[],
    strategy: RouteStrategy,
    optimizationDate: Date
  ): PendingOrder[][] {
    if (strategy === "FASTEST") {
      return orders.map((order) => [order]);
    }

    if (strategy === "FEWEST_RIDERS") {
      const clusters: PendingOrder[][] = [];
      for (
        let index = 0;
        index < orders.length;
        index += BUSINESS_RULES.MAX_ORDERS_PER_RIDER
      ) {
        clusters.push(
          orders.slice(
            index,
            index + BUSINESS_RULES.MAX_ORDERS_PER_RIDER
          )
        );
      }
      return clusters;
    }

    return this.findLowestCostPartition(orders, optimizationDate);
  }

  // ค้นหาการแบ่งกลุ่มที่มีต้นทุนรวมต่ำที่สุด
  private static findLowestCostPartition(
    orders: readonly PendingOrder[],
    optimizationDate: Date
  ): PendingOrder[][] {
    const best: Array<PartitionCandidate | undefined> =
      new Array(orders.length + 1);
    best[orders.length] = {
      clusters: [],
      lateTaskCount: 0,
      deliveryFee: 0,
      totalDistanceKm: 0,
      maxEstimatedMinutes: 0,
    };

    for (let index = orders.length - 1; index >= 0; index -= 1) {
      for (
        let size = 1;
        size <= BUSINESS_RULES.MAX_ORDERS_PER_RIDER;
        size += 1
      ) {
        if (index + size > orders.length) break;
        const suffix = best[index + size];
        if (!suffix) continue;

        const cluster = orders.slice(index, index + size);
        const task = this.buildTask(
          cluster,
          1,
          0,
          optimizationDate
        );
        const candidate: PartitionCandidate = {
          clusters: [cluster, ...suffix.clusters],
          lateTaskCount:
            (task.isLate ? 1 : 0) + suffix.lateTaskCount,
          deliveryFee: roundMoney(
            task.deliveryFee + suffix.deliveryFee
          ),
          totalDistanceKm: roundMoney(
            task.totalDistanceKm + suffix.totalDistanceKm
          ),
          maxEstimatedMinutes: Math.max(
            task.estimatedMinutes,
            suffix.maxEstimatedMinutes
          ),
        };

        if (
          !best[index] ||
          this.compareCostCandidates(candidate, best[index]!) < 0
        ) {
          best[index] = candidate;
        }
      }
    }

    return best[0]?.clusters ?? [];
  }

  // เปรียบเทียบต้นทุนของแผนการแบ่งกลุ่มสองแบบ
  private static compareCostCandidates(
    left: PartitionCandidate,
    right: PartitionCandidate
  ): number {
    return (
      left.lateTaskCount - right.lateTaskCount ||
      left.deliveryFee - right.deliveryFee ||
      left.totalDistanceKm - right.totalDistanceKm ||
      left.clusters.length - right.clusters.length ||
      left.maxEstimatedMinutes - right.maxEstimatedMinutes
    );
  }

  // สร้างรายละเอียดใบงานจากกลุ่มออเดอร์
  private static buildTask(
    cluster: readonly PendingOrder[],
    sequenceNumber: number,
    colorIndex: number,
    optimizationDate: Date
  ): ProposedTask {
    const hub = BUSINESS_RULES.HUB;
    const bestSequence = this.findBestTspSequence(hub, cluster);
    let currentPoint: GeoPoint = hub;
    let totalDistanceKmRaw = 0;
    let elapsedMinutes = 0;
    let totalBoxes = 0;
    const stops: OptimizedStop[] = [];
    const waypoints: [number, number][] = [
      [hub.latitude, hub.longitude],
    ];

    bestSequence.forEach((order, stopIndex) => {
      const destination: GeoPoint = {
        latitude: order.customer.latitude,
        longitude: order.customer.longitude,
      };
      const legDistanceKmRaw = this.calculateRoadDistanceKm(
        currentPoint,
        destination
      );
      totalDistanceKmRaw += legDistanceKmRaw;
      elapsedMinutes +=
        (legDistanceKmRaw / BUSINESS_RULES.AVERAGE_SPEED_KMH) * 60;

      // "ถึงมือลูกค้า" is complete only after the hand-off service time.
      elapsedMinutes += BUSINESS_RULES.SERVICE_TIME_PER_STOP_MINS;
      totalBoxes += order.boxAmount;

      stops.push({
        orderId: order.id,
        stopSequence: stopIndex + 1,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        addressDetail: order.customer.addressDetail,
        latitude: destination.latitude,
        longitude: destination.longitude,
        boxAmount: order.boxAmount,
        itemPrice: order.totalPrice,
        distanceFromPrevKm: roundMoney(legDistanceKmRaw),
        estArrival: this.formatTime(
          BUSINESS_RULES.DEPARTURE_TIME,
          elapsedMinutes
        ),
        navigationUrl: this.createNavigationUrl(
          destination.latitude,
          destination.longitude
        ),
      });

      waypoints.push([destination.latitude, destination.longitude]);
      currentPoint = destination;
    });

    const totalDistanceKm = roundMoney(totalDistanceKmRaw);
    const estimatedMinutes = Math.ceil(
      elapsedMinutes - Number.EPSILON
    );
    const deliveryFee = roundMoney(
      BUSINESS_RULES.RIDER_BASE_FEE +
        BUSINESS_RULES.RIDER_RATE_PER_KM_PER_BOX *
          totalDistanceKmRaw *
          totalBoxes
    );
    const totalRevenue = roundMoney(
      totalBoxes * BUSINESS_RULES.PRICE_PER_BOX
    );
    const totalFoodCost = roundMoney(
      totalBoxes * BUSINESS_RULES.FOOD_COST_PER_BOX
    );

    return {
      taskNumber: `TASK-${formatBangkokDateKey(
        optimizationDate
      )}-${String(sequenceNumber).padStart(2, "0")}`,
      routeColor:
        BUSINESS_RULES.ROUTE_COLORS[
          colorIndex % BUSINESS_RULES.ROUTE_COLORS.length
        ],
      totalDistanceKm,
      estimatedMinutes,
      totalBoxes,
      deliveryFee,
      totalRevenue,
      totalFoodCost,
      netProfit: roundMoney(
        totalRevenue - totalFoodCost - deliveryFee
      ),
      isLate:
        elapsedMinutes > BUSINESS_RULES.MAX_ALLOWED_MINUTES,
      stops,
      waypoints,
    };
  }

  // ค้นหาลำดับจุดส่งที่มีระยะทางสั้นที่สุด
  private static findBestTspSequence(
    start: GeoPoint,
    orders: readonly PendingOrder[]
  ): PendingOrder[] {
    if (orders.length <= 1) return [...orders];

    let bestSequence = [...orders];
    let minimumDistance = Number.POSITIVE_INFINITY;

    for (const sequence of this.getPermutations(orders)) {
      let distance = 0;
      let currentPoint = start;
      for (const order of sequence) {
        distance += this.calculateRoadDistanceKm(
          currentPoint,
          order.customer
        );
        currentPoint = order.customer;
      }

      if (distance < minimumDistance) {
        minimumDistance = distance;
        bestSequence = sequence;
      }
    }
    return bestSequence;
  }

  // สร้างลำดับความเป็นไปได้ทั้งหมดของรายการ
  private static getPermutations<T>(
    items: readonly T[]
  ): T[][] {
    if (items.length <= 1) return [[...items]];

    const result: T[][] = [];
    for (let index = 0; index < items.length; index += 1) {
      const remaining = [
        ...items.slice(0, index),
        ...items.slice(index + 1),
      ];
      for (const subPermutation of this.getPermutations(remaining)) {
        result.push([items[index], ...subPermutation]);
      }
    }
    return result;
  }
}
