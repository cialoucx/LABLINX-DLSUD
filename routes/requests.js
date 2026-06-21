const express = require("express");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const {
  categoryAdminMap,
  adminCategoryMapping,
} = require("../config/constants");
const { broadcastRefresh } = require("../utils/websocket");
const { sendEmail } = require("../utils/email");
const ItemRequest = require("../models/ItemRequest");
const User = require("../models/User");
const Incident = require("../models/Incident");
const Notification = require("../models/Notification");
const SystemSettings = require("../models/SystemSettings");

const {
  logAdminAction,
  checkStockAndNotify,
  findItemInAllowedCategory,
  findAndUpdateItemForAdmin,
  extractBaseId,
  findAvailableItemsInGroup,
} = require("./helpers");

const router = express.Router();

// Helper to resolve system setting value
const getSettingValue = async (settingKey) => {
  const globalSetting = await SystemSettings.findOne({ key: settingKey });
  if (globalSetting) return Number(globalSetting.value);

  const { DEFAULT_SYSTEM_SETTINGS } = require("../config/constants");
  return DEFAULT_SYSTEM_SETTINGS[settingKey];
};

// POST create request
router.post("/api/request-item", isAuthenticated, async (req, res) => {
  try {
    const { itemId, itemName, quantity, startDate, dueDate, reason, category } =
      req.body;
    const { id: studentId, fullName: studentName } = req.session.user;

    const user = await User.findById(studentId);
    if (!user) return res.status(404).send("Student not found.");

    if (user.isSuspended) {
      return res.status(403).json({
        message: `Request blocked: You are suspended from borrowing equipment. Reason: ${
          user.suspensionReason ||
          "Failed to submit incident report within 48 hours"
        }.`,
      });
    }

    const pendingIncident = await Incident.findOne({
      "responsibleUser._id": user._id,
      status: "Pending Replacement",
    });
    if (pendingIncident) {
      return res.status(403).json({
        message: `Request blocked: You have a pending accountability for a damaged item (${pendingIncident.damagedItemInfo.name}). Please see the lab admin.`,
      });
    }

    const settingsAdminUsername = categoryAdminMap[category] || "admin";
    const borrowingLimit = await getSettingValue("borrowing_limit");
    const activeBorrows = await ItemRequest.countDocuments({
      studentId,
      status: "Approved",
    });
    if (activeBorrows + quantity > borrowingLimit) {
      return res.status(403).json({
        message: `Borrowing limit reached. You can borrow up to ${borrowingLimit} items at a time. Currently: ${activeBorrows} active requests.`,
      });
    }

    const maxBorrowDays = await getSettingValue("max_borrow_days");
    if (startDate && dueDate) {
      const daysDiff = Math.ceil(
        (new Date(dueDate) - new Date(startDate)) / (1000 * 60 * 60 * 24),
      );
      if (daysDiff > maxBorrowDays) {
        return res.status(400).json({
          message: `Borrowing duration exceeds the maximum of ${maxBorrowDays} days.`,
        });
      }
    }

    const baseId = extractBaseId(itemId);
    const availableItems = await findAvailableItemsInGroup(
      baseId,
      itemName,
      category,
      quantity,
      studentId,
    );

    if (availableItems.length < quantity) {
      return res.status(409).json({
        message: `Insufficient items available. Only ${availableItems.length} out of ${quantity} requested items are available.`,
      });
    }

    const requestsToCreate = [];
    for (let i = 0; i < quantity; i++) {
      const item = availableItems[i];
      requestsToCreate.push({
        itemId: item.itemId,
        itemName: item.itemName,
        studentId,
        studentName,
        studentID: user.studentID,
        quantity: 1,
        startDate,
        dueDate,
        reason,
        category: item.category,
      });
    }

    const createdRequests = await ItemRequest.insertMany(requestsToCreate);

    const adminUsername = categoryAdminMap[category];
    if (adminUsername && createdRequests.length > 0) {
      const targetAdmin = await User.findOne({ username: adminUsername });
      if (targetAdmin) {
        const notificationsToCreate = createdRequests.map((request) => ({
          userId: targetAdmin._id,
          title: "New Student Request",
          message: `${studentName} requested ${request.itemName} (${request.itemId}).`,
        }));
        await Notification.insertMany(notificationsToCreate);
      }
    }

    broadcastRefresh();

    res.status(201).json({
      message: `Successfully created ${createdRequests.length} request(s).`,
      requests: createdRequests,
    });
  } catch (e) {
    console.error("Request Error:", e);
    res.status(500).json({ message: "Error creating request." });
  }
});

// GET my-requests (for active student)
router.get("/api/my-requests", isAuthenticated, async (req, res) => {
  try {
    const requests = await ItemRequest.find({
      studentId: req.session.user.id,
      isDeleted: { $ne: true },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Error fetching requests." });
  }
});

// GET admin requests (scoped by categories)
router.get("/api/admin-requests", isAdmin, async (req, res) => {
  try {
    const requests = await ItemRequest.find({
      category: { $in: ["General", "Office Supplies"] },
      isDeleted: { $ne: true },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Error fetching requests for admin." });
  }
});

router.get("/api/admin2-requests", isAdmin, async (req, res) => {
  try {
    const requests = await ItemRequest.find({
      category: { $in: ["Science", "Sports"] },
      isDeleted: { $ne: true },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res
      .status(500)
      .json({ message: "Error fetching science and sports requests." });
  }
});

router.get("/api/admin3-requests", isAdmin, async (req, res) => {
  try {
    const requests = await ItemRequest.find({
      category: {
        $in: [
          "Tables & Chairs",
          "Computer Lab",
          "Food Lab",
          "Music Instruments",
        ],
      },
      isDeleted: { $ne: true },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Error fetching admin3 requests." });
  }
});

router.get("/api/admin-requests/Robotics", isAdmin, async (req, res) => {
  try {
    const requests = await ItemRequest.find({
      category: "Robotics",
      isDeleted: { $ne: true },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Error fetching robotics requests." });
  }
});

// GET deleted requests (trash list)
router.get("/api/deleted-requests", isAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.user.username.toLowerCase();
    const allowedCategories = adminCategoryMapping[adminUsername];
    if (!allowedCategories) return res.json([]);

    const requests = await ItemRequest.find({
      isDeleted: true,
      category: { $in: allowedCategories },
    }).sort({ requestDate: -1 });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ message: "Error fetching deleted requests." });
  }
});

// PUT edit request
router.put("/api/edit-request/:id", isAdmin, async (req, res) => {
  try {
    const { quantity, ...otherUpdates } = req.body;
    const newQuantity = parseInt(quantity, 10);

    const request = await ItemRequest.findById(req.params.id);
    if (!request)
      return res.status(404).json({ message: "Request not found." });

    const oldQuantity = request.quantity;

    request.set({
      ...otherUpdates,
      quantity: newQuantity || oldQuantity,
    });

    await request.save();
    await logAdminAction(
      req,
      "Edit Request",
      `Edited details for request ID ${request._id} from student ${request.studentName}.`,
    );

    broadcastRefresh();
    res.json({ message: "Request updated successfully!", request });
  } catch (e) {
    console.error("Edit Request Error:", e);
    res.status(500).json({ message: "Error updating request." });
  }
});

// PUT soft delete request
router.put("/api/requests/:id/delete", isAdmin, async (req, res) => {
  try {
    const request = await ItemRequest.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true },
      { new: true },
    );
    if (!request)
      return res.status(404).json({ message: "Request not found." });

    await logAdminAction(
      req,
      "Delete Request",
      `Moved request ID ${request._id} for '${request.itemName}' to trash.`,
    );
    broadcastRefresh();
    res.json({ message: "Request moved to trash." });
  } catch (e) {
    res.status(500).json({ message: "Error deleting request." });
  }
});

// PUT restore request
router.put("/api/requests/:id/restore", isAdmin, async (req, res) => {
  try {
    const request = await ItemRequest.findByIdAndUpdate(
      req.params.id,
      { isDeleted: false },
      { new: true },
    );
    if (!request)
      return res.status(404).json({ message: "Request not found." });

    await logAdminAction(
      req,
      "Restore Request",
      `Restored request ID ${request._id} for '${request.itemName}'.`,
    );
    broadcastRefresh();
    res.json({ message: "Request restored successfully." });
  } catch (e) {
    res.status(500).json({ message: "Error restoring request." });
  }
});

// DELETE permanently delete request
router.delete("/api/requests/:id/permanent", isAdmin, async (req, res) => {
  try {
    const request = await ItemRequest.findByIdAndDelete(req.params.id);
    if (!request)
      return res.status(404).json({ message: "Request not found." });

    await logAdminAction(
      req,
      "Permanent Delete Request",
      `Permanently deleted request ID ${request._id} for '${request.itemName}'.`,
    );
    broadcastRefresh();
    res.json({ message: "Request permanently deleted." });
  } catch (e) {
    res.status(500).json({ message: "Error permanently deleting request." });
  }
});

// PUT update request status (Approve, Reject, Return, etc.)
router.put("/api/update-request/:id", isAdmin, async (req, res) => {
  const { status } = req.body;
  if (!["Approved", "Rejected", "Returned", "Pending"].includes(status)) {
    return res.status(400).json({ message: "Invalid status." });
  }

  try {
    const request = await ItemRequest.findById(req.params.id);
    if (!request)
      return res.status(404).json({ message: "Request not found." });

    const originalStatus = request.status;
    if (originalStatus === status) {
      return res.json({ message: "Status is already set.", request });
    }

    const wasPending = originalStatus === "Pending";
    const isApproved = status === "Approved";
    const isRejected = status === "Rejected";
    const wasApproved = originalStatus === "Approved";
    const isReturned = status === "Returned";

    if (wasPending && isApproved) {
      const itemToUpdate = await findItemInAllowedCategory(
        request.itemId,
        req.session.user.username,
      );
      if (!itemToUpdate || itemToUpdate.quantity < request.quantity) {
        return res.status(409).json({
          message: "Cannot approve request. Insufficient stock available.",
        });
      }
      if (itemToUpdate.status !== "Available") {
        return res.status(409).json({
          message: `Cannot approve request. Item is currently ${itemToUpdate.status}.`,
        });
      }
      const updatedItem = await findAndUpdateItemForAdmin(
        request.itemId,
        -request.quantity,
        req.session.user.username,
      );
      await checkStockAndNotify(updatedItem);
    } else if (wasApproved && isReturned) {
      const item = await findItemInAllowedCategory(
        request.itemId,
        req.session.user.username,
      );
      if (item && item.status !== "Damaged" && item.status !== "Calibration") {
        await findAndUpdateItemForAdmin(
          request.itemId,
          request.quantity,
          req.session.user.username,
        );
      } else if (
        item &&
        (item.status === "Damaged" || item.status === "Calibration")
      ) {
        console.log(
          `Item ${item.itemId} was returned, but is ${item.status}. Not returning to stock.`,
        );
      }
    }

    request.status = status;
    await request.save();

    await logAdminAction(
      req,
      "Update Request Status",
      `Set status for '${request.itemName}' (Student: ${request.studentName}) to '${status}'.`,
    );

    const student = await User.findById(request.studentId);

    // Notification creation
    const newNotification = new Notification({
      userId: request.studentId,
      title: `Request ${status}`,
      message: `Your request for "${request.itemName}" has been ${status.toLowerCase()}.`,
    });
    await newNotification.save();

    // Email alert logic
    if (student && student.email) {
      let emailSubject = "";
      let emailBody = "";

      if (status === "Approved") {
        const dueDateStr = new Date(request.dueDate).toLocaleDateString();
        emailSubject = `✅ Request Approved: ${request.itemName}`;
        emailBody = `
          <p>Great news, ${student.firstName}!</p>
          <p>Your request for <strong>${request.quantity}x ${request.itemName}</strong> has been **APPROVED**.</p>
          <p>The due date for its return is **${dueDateStr}**.</p>
          <p>Please proceed to the respective laboratory to claim your item(s).</p>
          <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
        `;
      } else if (status === "Rejected") {
        emailSubject = `❌ Request Rejected: ${request.itemName}`;
        emailBody = `
          <p>Hello ${student.firstName},</p>
          <p>Your request for <strong>${request.quantity}x ${request.itemName}</strong> has been **REJECTED**.</p>
          <p>Please check your LabLinx account for more details or submit a new request.</p>
          <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
        `;
      } else if (status === "Returned") {
        emailSubject = `✅ Item Returned: ${request.itemName}`;
        emailBody = `
          <p>Hello ${student.firstName},</p>
          <p>Your item(s) <strong>${request.quantity}x ${request.itemName}</strong> has been marked as **RETURNED** successfully.</p>
          <p>Thank you for using LabLinx.</p>
          <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
        `;
      }

      if (emailSubject) {
        await sendEmail(student.email, emailSubject, emailBody);
      }
    }

    broadcastRefresh();
    res.json({ message: `Request status updated to ${status}.`, request });
  } catch (e) {
    console.error("Update Request Status Error:", e);
    res.status(500).json({ message: "Error updating request status." });
  }
});

module.exports = router;
