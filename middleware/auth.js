const rateLimit = require("express-rate-limit");

// Helper to get allowed CORS origins dynamically
const getClientOrigins = () => {
  return (
    process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const getBaseOriginFromRequest = (req) => {
  return `${req.protocol}://${req.get("host")}`;
};

const isSameOriginStateChangingRequest = (req) => {
  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");
  const source = originHeader || refererHeader;

  // Non-browser tools may not send Origin/Referer; allow but rely on auth/session checks.
  if (!source) return true;

  try {
    const sourceOrigin = new URL(source).origin;
    const allowedOrigins = new Set([
      getBaseOriginFromRequest(req),
      ...getClientOrigins(),
    ]);
    return allowedOrigins.has(sourceOrigin);
  } catch (error) {
    return false;
  }
};

const isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).redirect("/login");
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === "admin") return next();
  res.status(403).json({ message: "Access denied." });
};

const isSuperAdmin = (req, res, next) => {
  if (
    req.session.user &&
    req.session.user.username.toLowerCase() === "admin2"
  ) {
    return next();
  }
  res.status(403).json({ message: "Forbidden: Super admin access required." });
};

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many authentication attempts. Please try again later.",
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests. Please slow down and try again.",
});

const corsOptionsDelegate = (req, callback) => {
  const requestOrigin = req.header("Origin");
  const sameOrigin = `${req.protocol}://${req.get("host")}`;

  // Allow same-origin and non-browser requests (no Origin header).
  if (!requestOrigin || requestOrigin === sameOrigin) {
    return callback(null, { origin: true, credentials: true });
  }

  const allowedOrigins = getClientOrigins();
  if (allowedOrigins.includes(requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }

  return callback(new Error("CORS blocked for this origin."));
};

const csrfMitigation = (req, res, next) => {
  const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!stateChangingMethods.has(req.method)) return next();

  if (!isSameOriginStateChangingRequest(req)) {
    return res.status(403).send("Blocked by CSRF protection.");
  }

  return next();
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isSuperAdmin,
  authLimiter,
  apiLimiter,
  corsOptionsDelegate,
  csrfMitigation,
};
