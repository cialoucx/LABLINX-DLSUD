const express = require("express");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const History = require("../models/History");
const ReportHistory = require("../models/ReportHistory");
const ItemRequest = require("../models/ItemRequest");
const { broadcastRefresh } = require("../utils/websocket");
const { logAdminAction } = require("./helpers");

const router = express.Router();

// GET /api/admin/history
router.get("/api/admin/history", isAdmin, async (req, res) => {
  try {
    const historyLogs = await History.find({})
      .sort({ timestamp: -1 })
      .limit(100);
    res.json(historyLogs);
  } catch (e) {
    res.status(500).json({ message: "Error fetching history logs." });
  }
});

// POST /api/reports
router.post("/api/reports", isAdmin, async (req, res) => {
  try {
    const { reportType } = req.body;
    if (!reportType) {
      return res.status(400).json({ message: "Report type is required." });
    }

    const newReport = new ReportHistory({
      reportType,
      generatedBy: req.session.user.username,
    });
    await newReport.save();

    await logAdminAction(
      req,
      "Generate Report",
      `Generated a ${reportType} report.`,
    );

    broadcastRefresh();
    res.status(201).json(newReport);
  } catch (e) {
    res.status(500).json({ message: "Error saving report." });
  }
});

// GET /api/reports
router.get("/api/reports", isAdmin, async (req, res) => {
  try {
    const reports = await ReportHistory.find({}).sort({ generatedAt: -1 });
    res.json(reports);
  } catch (e) {
    res.status(500).json({ message: "Error fetching reports." });
  }
});

// GET /api/reports/user-accountability
router.get(
  "/api/reports/user-accountability",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    try {
      const accountabilityReport = await ItemRequest.aggregate([
        {
          $match: {
            status: "Returned",
          },
        },
        {
          $group: {
            _id: {
              studentId: "$studentId",
              studentName: "$studentName",
              returnCondition: "$returnCondition",
            },
            totalQuantity: { $sum: "$quantity" },
            totalRequests: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.studentId",
            studentName: { $first: "$_id.studentName" },
            good: {
              $sum: {
                $cond: [
                  { $eq: ["$_id.returnCondition", "Good"] },
                  "$totalQuantity",
                  0,
                ],
              },
            },
            damaged: {
              $sum: {
                $cond: [
                  { $in: ["$_id.returnCondition", ["Damaged", "Lost"]] },
                  "$totalQuantity",
                  0,
                ],
              },
            },
            totalReturned: { $sum: "$totalQuantity" },
          },
        },
        {
          $lookup: {
            from: "incidents",
            localField: "_id",
            foreignField: "responsibleUser._id",
            as: "incidents",
          },
        },
        {
          $project: {
            _id: 0,
            studentId: "$_id",
            studentName: 1,
            good: 1,
            damaged: 1,
            totalReturned: 1,
            pendingIncidents: {
              $size: {
                $filter: {
                  input: "$incidents",
                  as: "incident",
                  cond: { $eq: ["$$incident.status", "Pending Replacement"] },
                },
              },
            },
          },
        },
        {
          $sort: { studentName: 1 },
        },
      ]);

      res.json(accountabilityReport);
    } catch (e) {
      console.error("User Accountability Report Error:", e);
      res
        .status(500)
        .json({ message: "Error fetching user accountability report." });
    }
  },
);

module.exports = router;
