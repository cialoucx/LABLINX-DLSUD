const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const passport = require("passport");
const connectMongo = require("connect-mongo");

dotenv.config();

const MongoStore = connectMongo.default || connectMongo;
const { MS_PER_DAY } = require("./config/constants");

function ensureEnv(variableName, defaultValue = null) {
  const value = process.env[variableName];
  if (!value) {
    if (defaultValue !== null) {
      console.warn(
        `[SERVER WARN] Missing env variable ${variableName}. Using default: ${defaultValue}`,
      );
      return defaultValue;
    }
    const placeholder = `placeholder_${variableName.toLowerCase()}`;
    console.warn(
      `[SERVER WARN] Missing critical env variable ${variableName}. Using placeholder: ${placeholder}`,
    );
    return placeholder;
  }
  return value;
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.LOCAL_DATABASE_URL ||
  "mongodb://127.0.0.1:27017/lablinx";
const DATABASE_NAME = process.env.DATABASE_NAME || "lablinx";

ensureEnv("SENDGRID_FROM", "no-reply@dlsud.edu.ph");
ensureEnv("SENDGRID_API_KEY", "SG.placeholder_key");
ensureEnv("MICROSOFT_CLIENT_ID", "placeholder_client_id");
ensureEnv("MICROSOFT_CLIENT_SECRET", "placeholder_client_secret");
ensureEnv("MICROSOFT_TENANT_ID", "placeholder_tenant_id");

if (!process.env.MICROSOFT_CALLBACK_URL) {
  process.env.MICROSOFT_CALLBACK_URL = "/auth/microsoft/callback";
}
ensureEnv("MICROSOFT_CALLBACK_URL");

const { connectToDatabase } = require("./config/db");
const { initPassport } = require("./config/passport");
const { seedDatabase } = require("./utils/seed");
const { initCronJobs } = require("./utils/cron");
const { setWss } = require("./utils/websocket");

const app = express();
const PORT = process.env.PORT || 3000;

connectToDatabase().then(() => {
  seedDatabase();
});

initPassport(passport);

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

const {
  authLimiter,
  apiLimiter,
  corsOptionsDelegate,
  csrfMitigation,
} = require("./middleware/auth");

app.use(cors(corsOptionsDelegate));
app.use((error, req, res, next) => {
  if (error && error.message === "CORS blocked for this origin.") {
    return res.status(403).json({ message: "CORS blocked for this origin." });
  }
  return next(error);
});

app.use("/login", authLimiter);
app.use("/register", authLimiter);
app.use("/auth", authLimiter);
app.use("/api", apiLimiter);

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[SERVER ERROR] SESSION_SECRET is not set in production. Please set SESSION_SECRET in environment variables.",
    );
  }
  sessionSecret = "lablinx-default-development-session-secret";
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: DATABASE_URL,
      dbName: DATABASE_NAME,
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: MS_PER_DAY,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());
app.use(csrfMitigation);

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

app.use(express.static(path.join(__dirname, "public")));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res
    .status(err.status || 500)
    .json({ message: err.message || "Internal Server Error" });
});

if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`[SERVER] Running at http://localhost:${PORT}`);
  });
  setWss(server);
  initCronJobs();
}

module.exports = app;
