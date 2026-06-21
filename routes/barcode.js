const express = require("express");
const { isAdmin } = require("../middleware/auth");
const { broadcastRefresh } = require("../utils/websocket");
const { sendEmail } = require("../utils/email");
const User = require("../models/User");
const Incident = require("../models/Incident");
const ItemRequest = require("../models/ItemRequest");
const StudentIncidentReport = require("../models/StudentIncidentReport");
const Notification = require("../models/Notification");
const ItemHistory = require("../models/ItemHistory");
const SystemSettings = require("../models/SystemSettings");

const {
  logAdminAction,
  checkStockAndNotify,
  findItemInAllowedCategory,
  findAndUpdateItemForAdmin,
  findModelAndItemForAdmin,
} = require("./helpers");

const router = express.Router();

const getSettingValue = async (settingKey) => {
  const globalSetting = await SystemSettings.findOne({ key: settingKey });
  if (globalSetting) return Number(globalSetting.value);

  const { DEFAULT_SYSTEM_SETTINGS } = require("../config/constants");
  return DEFAULT_SYSTEM_SETTINGS[settingKey];
};

// POST /api/borrow-by-barcode
router.post("/api/borrow-by-barcode", isAdmin, async (req, res) => {
  try {
    const { itemId, studentID } = req.body;
    const adminUsername = req.session.user.username;

    const user = await User.findOne({ studentID });
    if (!user) {
      return res
        .status(404)
        .json({ message: `User with ID ${studentID} not found.` });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        message: `BORROW BLOCKED: User is suspended from borrowing equipment. Reason: ${
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
        message: `BORROW BLOCKED: User has a pending accountability for: ${pendingIncident.damagedItemInfo.name}.`,
      });
    }

    const borrowingLimit = await getSettingValue("borrowing_limit");
    const activeBorrows = await ItemRequest.countDocuments({
      studentId: user._id,
      status: "Approved",
    });
    if (activeBorrows >= borrowingLimit) {
      return res.status(403).json({
        message: `BORROW BLOCKED: User has reached the active borrowing limit.`,
      });
    }

    const item = await findItemInAllowedCategory(itemId, adminUsername);
    if (!item) {
      return res.status(404).json({
        message: `Item with ID ${itemId} not found in your managed inventories.`,
      });
    }
    if (item.quantity < 1) {
      return res
        .status(400)
        .json({ message: `Item "${item.name}" is out of stock.` });
    }

    if (item.status !== "Available") {
      return res.status(400).json({
        message: `Item "${item.name}" is not available (Status: ${item.status}).`,
      });
    }

    const updatedItem = await findAndUpdateItemForAdmin(
      itemId,
      -1,
      adminUsername,
    );
    await checkStockAndNotify(updatedItem);

    const startDate = new Date();
    const dueDate = new Date(startDate);
    const maxBorrowDays = await getSettingValue("max_borrow_days");
    dueDate.setDate(startDate.getDate() + maxBorrowDays);

    const newRequest = new ItemRequest({
      itemId,
      itemName: item.name,
      studentId: user._id,
      studentName: `${user.firstName} ${user.lastName}`,
      studentID: user.studentID,
      quantity: 1,
      startDate,
      dueDate,
      reason: "Borrowed via Live Scan",
      status: "Approved",
      category: item.category,
    });
    await newRequest.save();

    await new ItemHistory({
      itemId,
      action: "Borrowed",
      studentName: newRequest.studentName,
      studentID: user.studentID,
    }).save();

    await logAdminAction(
      req,
      "Live Scan Borrow",
      `Item '${item.name}' borrowed by ${newRequest.studentName}.`,
    );

    broadcastRefresh();
    res.json({
      message: `${item.name} successfully borrowed by ${newRequest.studentName}.`,
    });
  } catch (error) {
    console.error("Borrow by Barcode Error:", error);
    res
      .status(500)
      .json({ message: "Server error during borrow transaction." });
  }
});

// POST /api/return-by-barcode
router.post("/api/return-by-barcode", isAdmin, async (req, res) => {
  try {
    const { itemId, condition, damageNotes } = req.body;
    const adminUsername = req.session.user.username;

    const { item, Model } = await findModelAndItemForAdmin(
      itemId,
      adminUsername,
    );
    if (!item) {
      return res.status(404).json({
        message: `Item with ID ${itemId} not found in your managed inventories.`,
      });
    }

    const request = await ItemRequest.findOne({
      itemId,
      status: "Approved",
    }).sort({ requestDate: -1 });
    if (!request) {
      return res
        .status(404)
        .json({ message: `No active loan found for item ID ${itemId}.` });
    }

    request.status = "Returned";

    if (condition === "Damaged" || condition === "Lost") {
      request.returnCondition = condition;
      request.damageNotes = damageNotes;
      await request.save();

      item.status = "Damaged";
      item.quantity = 0;
      await item.save();

      const responsibleUser = await User.findById(request.studentId);
      const deadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const newIncident = new Incident({
        damagedItemInfo: {
          _id: item._id,
          itemId: item.itemId,
          name: item.name,
          category: item.category,
          modelName: Model.modelName,
        },
        responsibleUser: {
          _id: responsibleUser._id,
          studentID: responsibleUser.studentID,
          studentName: `${responsibleUser.firstName} ${responsibleUser.lastName}`,
        },
        originalTransaction: request._id,
        status: "Pending Replacement",
        damageNotes: damageNotes,
        deadlineAt: deadlineAt,
        notificationSent: false,
      });
      await newIncident.save();

      const studentReport = new StudentIncidentReport({
        incidentId: newIncident._id,
        studentId: responsibleUser._id,
        equipmentId: item.itemId,
        dateOfIncident: new Date(),
        incidentType:
          condition === "Lost"
            ? "Lost or Missing Item"
            : "Damage to Equipment/Facility",
        detailedDescription: "Pending student submission",
        deadlineAt: deadlineAt,
        status: "Pending Submission",
      });

      if (
        !studentReport.detailedDescription ||
        studentReport.detailedDescription.trim() === ""
      ) {
        studentReport.detailedDescription = "Pending student submission";
      }

      await studentReport.save();

      newIncident.studentReportId = studentReport._id;
      await newIncident.save();

      const studentNotification = new Notification({
        userId: responsibleUser._id,
        title: "Incident Report Required",
        message: `You must submit an incident report within 48 hours for the damaged item: ${item.name}. Click here to submit your report.`,
      });
      await studentNotification.save();

      if (responsibleUser.email) {
        const emailSubject = "⚠️ Incident Report Required - Action Required";
        const emailBody = `
          <p>Hello ${responsibleUser.firstName},</p>
          <p>An item you borrowed (<strong>${item.name}</strong>, ID: ${item.itemId}) has been marked as <strong>${condition}</strong> upon return.</p>
          <p><strong>⚠️ IMPORTANT:</strong> You must submit an incident report within <strong>48 hours</strong> of this notification. Failure to do so will result in suspension from borrowing equipment.</p>
          <p>Please log in to LabLinx and navigate to the <strong>Report Dashboard</strong> to submit your report.</p>
          <p><strong>Deadline:</strong> ${deadlineAt.toLocaleString()}</p>
          <p><em>LabLinx DLSU-D Team.</em></p>
        `;
        await sendEmail(responsibleUser.email, emailSubject, emailBody);
      }

      newIncident.notificationSent = true;
      await newIncident.save();

      const action =
        condition === "Lost" ? "Returned (Lost)" : "Returned (Damaged)";
      await new ItemHistory({
        itemId,
        action: action,
        studentName: request.studentName,
        studentID: request.studentID,
      }).save();

      await logAdminAction(
        req,
        `Live Scan Return (${condition})`,
        `Item '${request.itemName}' returned as ${condition} by ${request.studentName}. Incident created.`,
      );

      broadcastRefresh();
      res.json({
        message: `${request.itemName} returned as ${condition}. Incident report created. User is pending replacement.`,
      });
    } else {
      request.returnCondition = "Good";
      await request.save();

      await findAndUpdateItemForAdmin(itemId, 1, adminUsername);

      await new ItemHistory({
        itemId,
        action: "Returned",
        studentName: request.studentName,
        studentID: request.studentID,
      }).save();

      await logAdminAction(
        req,
        "Live Scan Return",
        `Item '${request.itemName}' returned by ${request.studentName}.`,
      );

      broadcastRefresh();
      res.json({ message: `${request.itemName} successfully returned.` });
    }
  } catch (error) {
    console.error("Return by Barcode Error:", error);
    res
      .status(500)
      .json({ message: "Server error during return transaction." });
  }
});

module.exports = router;
