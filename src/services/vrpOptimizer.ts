import { BUSINESS_RULES } from "../constants";

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
  waypoints: [number, number][]; // พิกัดสำหรับวาดเส้น Polyline บนแผนที่ [lat, lng]
}

export class VrpOptimizerService {
  /**
   * คำนวณระยะทางแบบ Haversine Distance (กิโลเมตร)
   */
  public static calculateHaversineDistance(p1: GeoPoint, p2: GeoPoint): number {
    const R = 6371; // รัศมีโลกเฉลี่ย (km)
    const dLat = this.deg2rad(p2.latitude - p1.latitude);
    const dLon = this.deg2rad(p2.longitude - p1.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(p1.latitude)) *
        Math.cos(this.deg2rad(p2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    // เผื่อระยะทางเลี้ยวตามถนนในเมือง (City winding factor 1.25)
    return Math.round(distanceKm * 1.25 * 100) / 100;
  }

  private static deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * คำนวณมุม Polar Angle เทียบกับจุดศูนย์กลางร้านค้า (Hub)
   * สำหรับใช้ใน Sweep Algorithm จัดกลุ่มออเดอร์ในทิศทางเดียวกัน
   */
  private static calculateAngleFromHub(point: GeoPoint): number {
    const hub = BUSINESS_RULES.HUB;
    const dy = point.latitude - hub.latitude;
    const dx = point.longitude - hub.longitude;
    let angle = Math.atan2(dy, dx); // เรเดียน (-PI ถึง PI)
    if (angle < 0) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * เพิ่มนาทีให้กับเวลาฐาน "11:30"
   */
  private static formatTime(baseTime: string, addMinutes: number): string {
    const [h, m] = baseTime.split(":").map(Number);
    const totalMinutes = h * 60 + m + Math.round(addMinutes);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }

  /**
   * สร้าง Google Maps Navigation URL
   */
  private static createNavUrl(lat: number, lng: number): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }

  /**
   * Main Algorithm: Vehicle Routing Problem (VRP) & TSP 2-Opt
   */
  public static optimizeRoutes(
    orders: PendingOrder[],
    startSequence: number = 1
  ): ProposedTask[] {
    if (!orders || orders.length === 0) return [];

    const hub = BUSINESS_RULES.HUB;

    // 1. เรียงลำดับออเดอร์ด้วย Sweep Algorithm (ตามมุม Polar Angle จาก Hub)
    // เพื่อให้ออเดอร์ที่อยู่ในโซน/ทิศทางเดียวกันถูกจัดกลุ่มเข้าด้วยกัน ป้องกันการวิ่งข้ามเมืองตัดกัน
    const sortedOrders = [...orders].sort((a, b) => {
      const angleA = this.calculateAngleFromHub(a.customer);
      const angleB = this.calculateAngleFromHub(b.customer);
      return angleA - angleB;
    });

    // 2. แบ่งกลุ่ม Cluster โดยไรเดอร์ 1 คน รับไม่เกิน 3 ออเดอร์
    const maxOrdersPerRider = BUSINESS_RULES.MAX_ORDERS_PER_RIDER;
    const clusters: PendingOrder[][] = [];
    for (let i = 0; i < sortedOrders.length; i += maxOrdersPerRider) {
      clusters.push(sortedOrders.slice(i, i + maxOrdersPerRider));
    }

    const proposedTasks: ProposedTask[] = [];
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // 3. ปรับลำดับการส่งในแต่ละ Cluster ด้วย Exhaustive Permutation / 2-Opt (TSP)
    clusters.forEach((cluster, index) => {
      const seqNumber = (startSequence + index).toString().padStart(2, "0");
      const taskNumber = `TASK-${dateStr}-${seqNumber}`;
      const routeColor =
        BUSINESS_RULES.ROUTE_COLORS[index % BUSINESS_RULES.ROUTE_COLORS.length];

      // หาเส้นทางที่สั้นที่สุดจาก Hub -> Stop 1 -> Stop 2 -> Stop 3
      const bestSequence = this.findBestTspSequence(hub, cluster);

      // คำนวณระยะทาง เวลา และค่าใช้จ่าย
      let currentPoint: GeoPoint = {
        latitude: hub.latitude,
        longitude: hub.longitude,
      };
      let totalDistance = 0;
      let elapsedMinutes = 0;
      let totalBoxes = 0;

      const stops: OptimizedStop[] = [];
      const waypoints: [number, number][] = [
        [hub.latitude, hub.longitude], // เริ่มจาก Hub
      ];

      bestSequence.forEach((order, seqIndex) => {
        const dest: GeoPoint = {
          latitude: order.customer.latitude,
          longitude: order.customer.longitude,
        };
        const legDistance = this.calculateHaversineDistance(currentPoint, dest);
        totalDistance += legDistance;

        // เวลาเดินทาง = (ระยะทาง / 30 กม./ชม.) * 60 นาที
        const travelMinutes =
          (legDistance / BUSINESS_RULES.AVERAGE_SPEED_KMH) * 60;
        elapsedMinutes += travelMinutes;

        const estArrival = this.formatTime(
          BUSINESS_RULES.DEPARTURE_TIME,
          elapsedMinutes
        );

        // เวลาส่งมอบที่หน้าร้าน/จุดส่ง 3 นาที
        elapsedMinutes += BUSINESS_RULES.SERVICE_TIME_PER_STOP_MINS;
        totalBoxes += order.boxAmount;

        stops.push({
          orderId: order.id,
          stopSequence: seqIndex + 1,
          customerName: order.customer.name,
          customerPhone: order.customer.phone,
          addressDetail: order.customer.addressDetail,
          latitude: dest.latitude,
          longitude: dest.longitude,
          boxAmount: order.boxAmount,
          itemPrice: order.totalPrice,
          distanceFromPrevKm: legDistance,
          estArrival,
          navigationUrl: this.createNavUrl(dest.latitude, dest.longitude),
        });

        waypoints.push([dest.latitude, dest.longitude]);
        currentPoint = dest;
      });

      totalDistance = Math.round(totalDistance * 100) / 100;
      const roundedMinutes = Math.round(elapsedMinutes);

      // สูตรค่าจ้างไรเดอร์: 15 + (2 x ระยะทาง x จำนวนกล่อง)
      const deliveryFee =
        BUSINESS_RULES.RIDER_BASE_FEE +
        BUSINESS_RULES.RIDER_RATE_PER_KM_PER_BOX * totalDistance * totalBoxes;
      const roundedDeliveryFee = Math.round(deliveryFee * 100) / 100;

      // รายได้ = กล่อง x 65
      const totalRevenue = totalBoxes * BUSINESS_RULES.PRICE_PER_BOX;
      // ต้นทุนอาหาร = กล่อง x 40
      const totalFoodCost = totalBoxes * BUSINESS_RULES.FOOD_COST_PER_BOX;
      // กำไรสุทธิ = รายได้ - ต้นทุนอาหาร - ค่าจ้างไรเดอร์
      const netProfit =
        Math.round((totalRevenue - totalFoodCost - roundedDeliveryFee) * 100) /
        100;

      // ตรวจสอบเงื่อนไขว่าส่งทันเวลา 12:30 น. (ภายใน 60 นาที) หรือไม่
      const isLate = roundedMinutes > BUSINESS_RULES.MAX_ALLOWED_MINUTES;

      proposedTasks.push({
        taskNumber,
        routeColor,
        totalDistanceKm: totalDistance,
        estimatedMinutes: roundedMinutes,
        totalBoxes,
        deliveryFee: roundedDeliveryFee,
        totalRevenue,
        totalFoodCost,
        netProfit,
        isLate,
        stops,
        waypoints,
      });
    });

    return proposedTasks;
  }

  /**
   * หา Permutation ที่ให้ระยะทางรวมสั้นที่สุด (Brute Force TSP for N <= 3)
   */
  private static findBestTspSequence(
    start: GeoPoint,
    orders: PendingOrder[]
  ): PendingOrder[] {
    if (orders.length <= 1) return orders;

    const permutations = this.getPermutations(orders);
    let bestSeq = orders;
    let minDistance = Infinity;

    for (const seq of permutations) {
      let d = 0;
      let curr = start;
      for (const order of seq) {
        d += this.calculateHaversineDistance(curr, order.customer);
        curr = order.customer;
      }

      if (d < minDistance) {
        minDistance = d;
        bestSeq = seq;
      }
    }

    return bestSeq;
  }

  private static getPermutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const current = arr[i];
      const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
      const subPerms = this.getPermutations(remaining);
      for (const sub of subPerms) {
        result.push([current, ...sub]);
      }
    }
    return result;
  }
}
