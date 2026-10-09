import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import customerRoutes from "./routes/customerRoutes";
import orderRoutes from "./routes/orderRoutes";
import routeRoutes from "./routes/routeRoutes";
import taskRoutes from "./routes/taskRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());

app.use("/api/customers", customerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/tasks", taskRoutes);

app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "Smart Lunch Delivery Route Optimization API",
    time: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Smart Lunch Delivery Backend Server running on port ${PORT}`);
  console.log(`📍 Endpoint: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);
});
