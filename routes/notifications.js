const express = require("express");
const mongoose = require("mongoose");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const Notification = require("../models/Notification");
const { broadcastRefresh } = require("../utils/websocket");

const router = express.Router();

// GET /api/my-notifications
router.get("/api/my-notifications", isAuthenticated, async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.session.user.id,
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).send("Error fetching notifications");
  }
});

// GET /api/admin/notifications
router.get("/api/admin/notifications", isAdmin, async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.session.user.id,
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).send("Error fetching admin notifications");
  }
});

// POST /api/notifications/mark-read
router.post(
  "/api/notifications/mark-read",
  isAuthenticated,
  async (req, res) => {
    try {
      const result = await Notification.updateMany(
        { userId: req.session.user.id, isRead: false },
        { $set: { isRead: true } },
      );

      if (result.modifiedCount > 0) {
        broadcastRefresh();
      }

      res.status(200).send("Notifications marked as read");
    } catch (error) {
      res.status(500).send("Error updating notifications");
    }
  },
);

// DELETE /api/notifications/:id
router.delete("/api/notifications/:id", isAuthenticated, async (req, res) => {
  try {
    const notificationId = req.params.id;
    console.log(
      "DELETE /api/notifications/:id called with ID:",
      notificationId,
    );

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res
        .status(400)
        .json({ message: "Invalid notification ID format" });
    }

    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    if (
      notification.userId &&
      notification.userId.toString() !== req.session.user.id.toString()
    ) {
      return res.status(403).json({
        message: "You do not have permission to delete this notification",
      });
    }

    await Notification.findByIdAndDelete(notificationId);
    broadcastRefresh();
    res.status(200).json({ message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res
      .status(500)
      .json({ message: error.message || "Error deleting notification" });
  }
});

module.exports = router;
