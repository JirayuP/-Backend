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

test("SLA uses final arrival, not service time after the final arrival", () => {
  const order = orderAtAngle(1, 90, 0.208);
  const [task] = VrpOptimizerService.optimizeRoutes(
    [order],
    1,
    new Date("2026-10-09T00:00:00.000Z")
  );

  assert.ok(task.estimatedMinutes > BUSINESS_RULES.MAX_ALLOWED_MINUTES);
  assert.equal(task.isLate, false);
  assert.equal(task.stops[0].estArrival, "12:28");
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
    /Invalid pending order data/
  );
});
