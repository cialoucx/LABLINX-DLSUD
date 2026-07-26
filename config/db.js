const mongoose = require("mongoose");
let isConnected = false;
async function connectToDatabase() {
  if (isConnected) return;
  const DATABASE_URL = process.env.DATABASE_URL;
  const DATABASE_NAME = process.env.DATABASE_NAME || "lablinx";
  const LOCAL_DATABASE_URL =
    process.env.LOCAL_DATABASE_URL || "mongodb://127.0.0.1:27017/lablinx";
  if (DATABASE_URL) {
    try {
      await mongoose.connect(DATABASE_URL, { dbName: DATABASE_NAME });
      isConnected = true;
      console.log("[DB] Connected successfully to remote database");
      return;
    } catch (error) {
      console.error("[DB ERROR] Remote connection:", error.message);
    }
  } else {
    console.warn("[DB WARN] DATABASE_URL is not set in environment variables.");
  }
  try {
    console.log(
      `[DB] Attempting fallback connection to: ${LOCAL_DATABASE_URL}`,
    );
    await mongoose.connect(LOCAL_DATABASE_URL, { dbName: DATABASE_NAME });
    isConnected = true;
    console.log("[DB] Connected successfully (local fallback)");
  } catch (fallbackError) {
    console.error(
      "[DB ERROR] Local fallback connection:",
      fallbackError.message,
    );
    console.warn(
      "[DB WARN] No database connection established. Database features will be unavailable.",
    );
  }
}
module.exports = { connectToDatabase: connectToDatabase };
