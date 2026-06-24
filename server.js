// ================== IMPORTS ==================
const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const passport = require("passport");
const connectMongo = require("connect-mongo");

// Load environment variables
dotenv.config();

// Connect Mongo Store (robust handling for ESM/CJS compat)
const MongoStore = connectMongo.default || connectMongo;

/**
 * Validate that an environment variable is set, or fall back to a default/placeholder
 * @param {string} variableName
 * @param {string|null} defaultValue
 * @returns {string}
 */
function ensureEnv(variableName, defaultValue = null) {
  const value = process.env[variableName];
  if (!value) {
    if (defaultValue !== null) {
      console.warn(`⚠️ Warning: Missing env variable ${variableName}. Using default: ${defaultValue}`);
      return defaultValue;
    }
    const placeholder = `placeholder_${variableName.toLowerCase()}`;
    console.warn(`⚠️ Warning: Missing critical env variable ${variableName}. Using placeholder: ${placeholder}`);
    return placeholder;
  }
  return value;
}

// Ensure critical environment variables exist on boot (or fallback gracefully for showcase)
const DATABASE_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || "mongodb://127.0.0.1:27017/lablinx";
const DATABASE_NAME = process.env.DATABASE_NAME || "lablinx";
ensureEnv("SENDGRID_FROM", "no-reply@dlsud.edu.ph");
ensureEnv("SENDGRID_API_KEY", "SG.placeholder_key");
ensureEnv("MICROSOFT_CLIENT_ID", "placeholder_client_id");
ensureEnv("MICROSOFT_CLIENT_SECRET", "placeholder_client_secret");
ensureEnv("MICROSOFT_TENANT_ID", "placeholder_tenant_id");

// Make callback URL optional on boot by falling back to relative path
if (!process.env.MICROSOFT_CALLBACK_URL) {
  process.env.MICROSOFT_CALLBACK_URL = "/auth/microsoft/callback";
}
ensureEnv("MICROSOFT_CALLBACK_URL");

// ================== INITIALIZATION ==================
const { connectToDatabase } = require("./config/db");
const { initPassport } = require("./config/passport");
const { seedDatabase } = require("./utils/seed");
const { initCronJobs } = require("./utils/cron");
const { setWss } = require("./utils/websocket");

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB Database
connectToDatabase().then(() => {
  // Run Database Seeding (Admins & Settings)
  seedDatabase();
});

// Configure Passport Strategies
initPassport(passport);

// ================== MIDDLEWARES ==================
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

// Import custom middleware controls
const {
  authLimiter,
  apiLimiter,
  corsOptionsDelegate,
  csrfMitigation,
} = require("./middleware/auth");

// CORS setup
app.use(cors(corsOptionsDelegate));
app.use((error, req, res, next) => {
  if (error && error.message === "CORS blocked for this origin.") {
    return res.status(403).json({ message: "CORS blocked for this origin." });
  }
  return next(error);
});

// Rate limiters
app.use("/login", authLimiter);
app.use("/register", authLimiter);
app.use("/auth", authLimiter);
app.use("/api", apiLimiter);

// Express Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "labsystem-secret-key-super-secure",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: DATABASE_URL,
      dbName: DATABASE_NAME,
      collectionName: "sessions",
      ttl: 24 * 60 * 60, // 1 day
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// CSRF mitigation
app.use(csrfMitigation);

// ================== ROUTES MOUNTING ==================
const pagesRouter = require("./routes/pages");
const authRouter = require("./routes/auth");
const inventoryRouter = require("./routes/inventory");
const requestsRouter = require("./routes/requests");
const barcodeRouter = require("./routes/barcode");
const incidentsRouter = require("./routes/incidents");
const notificationsRouter = require("./routes/notifications");
const reportsRouter = require("./routes/reports");
const systemRouter = require("./routes/system");
const usersRouter = require("./routes/users");

app.use(pagesRouter);
app.use(authRouter);
app.use(inventoryRouter);
app.use(requestsRouter);
app.use(barcodeRouter);
app.use(incidentsRouter);
app.use(notificationsRouter);
app.use(reportsRouter);
app.use(systemRouter);
app.use(usersRouter);

// Serve static files from public directory (AFTER routes to avoid conflicts)
app.use(express.static(path.join(__dirname, "public")));

// ================== GLOBAL ERROR HANDLER ==================
// Must be defined AFTER all routes. Catches any unhandled errors and prevents
// the Vercel serverless function from crashing with a 500/no-response.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
  });
});

// ================== SERVER STARTUP ==================
// Only start persistent listeners (HTTP, Websocket, Crons) when running directly
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
  });

  // Start Websocket server
  setWss(server);

  // Initialize automated background tasks
  initCronJobs();
}

// Export the Express app wrapper for serverless deployments (e.g., Vercel)
module.exports = app;
