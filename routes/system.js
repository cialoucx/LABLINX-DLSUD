const express = require("express");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const SystemSettings = require("../models/SystemSettings");
const ItemRequest = require("../models/ItemRequest");
const { logAdminAction } = require("./helpers");
const { broadcastRefresh } = require("../utils/websocket");

const {
  categoryAdminMap,
  adminCategoryMapping,
  DEFAULT_SYSTEM_SETTINGS,
} = require("../config/constants");

const router = express.Router();

const getScopedSettingKey = (settingKey, adminUsername) => {
  return settingKey;
};

const getSettingValue = async (settingKey, options = {}) => {
  const globalSetting = await SystemSettings.findOne({ key: settingKey });
  if (globalSetting) return Number(globalSetting.value);

  return DEFAULT_SYSTEM_SETTINGS[settingKey];
};

const getSettingsForAdmin = async (adminUsername) => {
  const keys = Object.keys(DEFAULT_SYSTEM_SETTINGS);
  const values = await Promise.all(
    keys.map((key) => getSettingValue(key, { adminUsername })),
  );

  const settingsObj = {};
  keys.forEach((key, index) => {
    settingsObj[key] = values[index];
  });
  return settingsObj;
};

// GET /api/system-settings
router.get("/api/system-settings", isAdmin, async (req, res) => {
  try {
    const adminUsername = String(req.session.user.username || "").toLowerCase();
    const settingsObj = await getSettingsForAdmin(adminUsername);
    res.json(settingsObj);
  } catch (error) {
    res.status(500).json({ message: "Error fetching settings." });
  }
});

// PUT /api/system-settings/:key
router.put("/api/system-settings/:key", isAdmin, async (req, res) => {
  try {
    const { value } = req.body;
    const key = req.params.key;
    const allowedSettingRules = {
      borrowing_limit: { min: 1, max: 50 },
      max_borrow_days: { min: 1, max: 365 },
      reservation_max_days: { min: 1, max: 365 },
      reservation_daily_rate: { min: 0, max: 1000000 },
      replacement_return_days: { min: 1, max: 365 },
    };

    if (!Object.prototype.hasOwnProperty.call(allowedSettingRules, key)) {
      return res.status(400).json({ message: "Invalid setting key." });
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return res
        .status(400)
        .json({ message: "Setting value must be numeric." });
    }

    const { min, max } = allowedSettingRules[key];
    if (numericValue < min || numericValue > max) {
      return res
        .status(400)
        .json({
          message: `Setting '${key}' must be between ${min} and ${max}.`,
        });
    }

    const adminUsername = String(req.session.user.username || "").toLowerCase();
    const scopedKey = getScopedSettingKey(key, adminUsername);

    const setting = await SystemSettings.findOneAndUpdate(
      { key: scopedKey },
      { value: numericValue, updatedAt: new Date() },
      { new: true, upsert: true },
    );

    await logAdminAction(
      req,
      "Update Setting",
      `Updated '${key}' to ${numericValue} (scope: ${adminUsername}).`,
    );

    broadcastRefresh();
    res.json({ message: "Setting updated.", setting });
  } catch (error) {
    res.status(500).json({ message: "Error updating setting." });
  }
});

// GET /api/borrowing-info
router.get("/api/borrowing-info", isAuthenticated, async (req, res) => {
  try {
    const requestedCategory = req.query.category;
    const scopedAdminUsername =
      categoryAdminMap[requestedCategory] ||
      (req.session.user.role === "admin"
        ? String(req.session.user.username || "").toLowerCase()
        : "admin");

    const borrowingLimit = await getSettingValue("borrowing_limit", {
      adminUsername: scopedAdminUsername,
    });
    const maxBorrowDays = await getSettingValue("max_borrow_days", {
      adminUsername: scopedAdminUsername,
    });
    const replacementReturnDays = await getSettingValue(
      "replacement_return_days",
      {
        adminUsername: scopedAdminUsername,
      },
    );
    const reservationMaxDays = await getSettingValue("reservation_max_days", {
      adminUsername: scopedAdminUsername,
    });

    const activeBorrows = await ItemRequest.countDocuments({
      studentId: req.session.user.id,
      status: { $in: ["Pending", "Approved"] },
    });

    res.json({
      borrowingLimit,
      maxBorrowDays,
      replacementReturnDays,
      reservationMaxDays,
      activeBorrows,
      remainingSlots: Math.max(0, borrowingLimit - activeBorrows),
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching borrowing info." });
  }
});

// GET /api/admin/past-due-requests
router.get("/api/admin/past-due-requests", isAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.user.username.toLowerCase();
    const allowedCategories = adminCategoryMapping[adminUsername];
    const filter = {
      status: "Approved",
      dueDate: { $lt: new Date() },
      isDeleted: { $ne: true },
    };
    if (allowedCategories) filter.category = { $in: allowedCategories };

    const overdueRequests = await ItemRequest.find(filter).sort({ dueDate: 1 });
    res.json(overdueRequests);
  } catch (error) {
    res.status(500).json({ message: "Error fetching past due requests." });
  }
});

// GET /api/my-past-due
router.get("/api/my-past-due", isAuthenticated, async (req, res) => {
  try {
    const overdueRequests = await ItemRequest.find({
      studentId: req.session.user.id,
      status: "Approved",
      dueDate: { $lt: new Date() },
    }).sort({ dueDate: 1 });
    res.json(overdueRequests);
  } catch (error) {
    res.status(500).json({ message: "Error fetching past due items." });
  }
});

module.exports = router;
