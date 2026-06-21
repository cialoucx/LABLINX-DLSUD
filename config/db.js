const mongoose = require("mongoose");

let isConnected = false;

async function connectToDatabase() {
  if (isConnected) return;

  const DATABASE_URL = process.env.DATABASE_URL;
  const DATABASE_NAME = process.env.DATABASE_NAME || "lablinx";
  const LOCAL_DATABASE_URL = process.env.LOCAL_DATABASE_URL || "mongodb://127.0.0.1:27017/lablinx";

  if (DATABASE_URL) {
    try {
      await mongoose.connect(DATABASE_URL, { dbName: DATABASE_NAME });
      isConnected = true;
      console.log("✅ MongoDB Connected Successfully to Remote Database");
      return;
    } catch (error) {
      console.error("❌ MongoDB Remote Connection Error:", error.message);
    }
  } else {
    console.warn("⚠️ DATABASE_URL is not set in environment variables.");
  }

  try {
    console.log(`🔌 Attempting fallback database connection to: ${LOCAL_DATABASE_URL}`);
    await mongoose.connect(LOCAL_DATABASE_URL, { dbName: DATABASE_NAME });
    isConnected = true;
    console.log("✅ MongoDB Connected Successfully (Local Fallback)");
  } catch (fallbackError) {
    console.error("❌ Fallback MongoDB Connection Error:", fallbackError.message);
    console.warn("⚠️ No MongoDB connection established. Features requiring a database will be unavailable.");
  }
}

module.exports = { connectToDatabase };
