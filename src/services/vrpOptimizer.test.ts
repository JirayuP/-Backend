import assert from "node:assert/strict";
import test from "node:test";
import { BUSINESS_RULES } from "../constants";
import {
  formatBangkokDateKey,
  PendingOrder,
  VrpOptimizerService,
} from "./vrpOptimizer";

function orderAtAngle(
  id: number,
  angleDegrees: number,
  radiusDegrees = 0.01
): PendingOrder {
  const radians = angleDegrees * (Math.PI / 180);
  return {
    id,
    boxAmount: 1,
    totalPrice: BUSINESS_RULES.PRICE_PER_BOX,
    customer: {
      id,
      name: `Customer ${id}`,
      phone: `08000000${id}`,
      addressDetail: `Address ${id}`,
      latitude: BUSINESS_RULES.HUB.latitude + Math.sin(radians) * radiusDegrees,
      longitude:
        BUSINESS_RULES.HUB.longitude + Math.cos(radians) * radiusDegrees,
    },
  };
}

test("circular sweep keeps orders around 359 and 0 degrees together", () => {
  const tasks = VrpOptimizerService.optimizeRoutes(
    [
      orderAtAngle(1, 359),
      orderAtAngle(2, 1),
      orderAtAngle(3, 10),
      orderAtAngle(4, 180),
    ],
    1,
    new Date("2026-10-09T00:00:00.000Z")
  );

  assert.equal(tasks.length, 2);
  assert.deepEqual(
    tasks[0].stops.map((stop) => stop.orderId).sort((a, b) => a - b),
    [1, 2, 3]
  );
  assert.deepEqual(tasks[1].stops.map((stop) => stop.orderId), [4]);
});

test("arrival and SLA include service time at the final stop", () => {
  const order = orderAtAngle(1, 90, 0);
  const [task] = VrpOptimizerService.optimizeRoutes(
    [order],
    1,
    new Date("2026-10-09T00:00:00.000Z")
  );

  assert.equal(task.estimatedMinutes, BUSINESS_RULES.SERVICE_TIME_PER_STOP_MINS);
  assert.equal(task.isLate, false);
  assert.equal(task.stops[0].estArrival, "11:33");
});

test("task date key follows Bangkok time instead of UTC date", () => {
  const beforeBangkokMidnight = new Date("2026-10-08T16:59:59.000Z");
  const afterBangkokMidnight = new Date("2026-10-08T17:00:00.000Z");

  assert.equal(formatBangkokDateKey(beforeBangkokMidnight), "20261008");
  assert.equal(formatBangkokDateKey(afterBangkokMidnight), "20261009");
});

test("invalid or duplicate order data is rejected before optimization", () => {
  const order = orderAtAngle(1, 0);
  assert.throws(
    () => VrpOptimizerService.optimizeRoutes([order, order]),
    /ข้อมูลออเดอร์/
  );
});

test("orders outside the three-kilometre service radius are rejected", () => {
  const outsideOrder = orderAtAngle(1, 0, 0.04);
  assert.throws(
    () => VrpOptimizerService.optimizeRoutes([outsideOrder]),
    /นอกรัศมีบริการ 3 กม/
  );
});

test("lowest-cost strategy may split a three-order sweep cluster", () => {
  const east = orderAtAngle(1, 0, 0.02);
  const west = orderAtAngle(2, 180, 0.02);
  const orders = [
    { ...east, boxAmount: 3, totalPrice: 195 },
    { ...west, id: 2, boxAmount: 3, totalPrice: 195 },
  ];

  const cheapest = VrpOptimizerService.optimizeRoutes(
    orders,
    1,
    new Date("2026-10-09T00:00:00.000Z"),
    "LOWEST_COST"
  );
  const fewestRiders = VrpOptimizerService.optimizeRoutes(
    orders,
    1,
    new Date("2026-10-09T00:00:00.000Z"),
    "FEWEST_RIDERS"
  );

  assert.equal(cheapest.length, 2);
  assert.equal(fewestRiders.length, 1);
  assert.ok(
    cheapest.reduce((sum, task) => sum + task.deliveryFee, 0) <
      fewestRiders[0].deliveryFee
  );
});
