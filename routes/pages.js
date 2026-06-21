const express = require("express");
const path = require("path");
const { isAuthenticated } = require("../middleware/auth");

const router = express.Router();

router.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "index.html")),
);

router.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "login.html")),
);

router.get("/admin", isAuthenticated, (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "admin_panel.html")),
);

router.get("/admin2", isAuthenticated, (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "admin_panel.html")),
);

router.get("/admin3", isAuthenticated, (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "admin_panel.html")),
);

router.get("/admin4", isAuthenticated, (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "admin_panel.html")),
);

router.get("/dashboard", isAuthenticated, (req, res) =>
  res.sendFile(path.join(__dirname, "../public", "student_dashboard.html")),
);

module.exports = router;
