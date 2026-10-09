import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import customerRoutes from "./routes/customerRoutes";
import orderRoutes from "./routes/orderRoutes";
import routeRoutes from "./routes/routeRoutes";
import taskRoutes from "./routes/taskRoutes";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`=======================================================`);
  console.log(`🚀 Smart Lunch Delivery Backend Server running on port ${PORT}`);
  console.log(`📍 Endpoint: http://0.0.0.0:${PORT}/api/health`);
  console.log(`=======================================================`);
});
