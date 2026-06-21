const express = require("express");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const StudentIncidentReport = require("../models/StudentIncidentReport");
const Incident = require("../models/Incident");
const User = require("../models/User");
const Notification = require("../models/Notification");
const SystemSettings = require("../models/SystemSettings");
const { sendEmail } = require("../utils/email");
const { broadcastRefresh } = require("../utils/websocket");
const { logAdminAction } = require("./helpers");
const { adminCategoryMapping } = require("../config/constants");

const router = express.Router();

const getSettingValue = async (settingKey) => {
  const globalSetting = await SystemSettings.findOne({ key: settingKey });
  if (globalSetting) return Number(globalSetting.value);

  const { DEFAULT_SYSTEM_SETTINGS } = require("../config/constants");
  return DEFAULT_SYSTEM_SETTINGS[settingKey];
};

// GET /api/student-incident-reports (student list)
router.get(
  "/api/student-incident-reports",
  isAuthenticated,
  async (req, res) => {
    try {
      const studentId = req.session.user.id;
      const reports = await StudentIncidentReport.find({ studentId })
        .populate({
          path: "incidentId",
          options: { strictPopulate: false },
        })
        .sort({ deadlineAt: 1 })
        .lean();
      res.json(reports || []);
    } catch (error) {
      console.error("Error fetching student incident reports:", error);
      res.status(500).json({ message: "Error fetching incident reports." });
    }
  },
);

// GET /api/student-incident-reports/:id (student details)
router.get(
  "/api/student-incident-reports/:id",
  isAuthenticated,
  async (req, res) => {
    try {
      const studentId = req.session.user.id;
      const report = await StudentIncidentReport.findOne({
        _id: req.params.id,
        studentId,
      }).populate("incidentId");
      if (!report)
        return res.status(404).json({ message: "Report not found." });
      res.json(report);
    } catch (error) {
      console.error("Error fetching incident report:", error);
      res.status(500).json({ message: "Error fetching incident report." });
    }
  },
);

// POST /api/student-incident-reports (student submit)
router.post(
  "/api/student-incident-reports",
  isAuthenticated,
  async (req, res) => {
    try {
      const studentId = req.session.user.id;
      const {
        incidentId,
        equipmentId,
        dateOfIncident,
        incidentType,
        detailedDescription,
        otherDescription,
        damageDescription,
        replacementAction,
        replacedItems,
      } = req.body;

      if (
        !incidentId ||
        !equipmentId ||
        !dateOfIncident ||
        !incidentType ||
        !detailedDescription
      ) {
        return res
          .status(400)
          .json({ message: "All required fields must be provided." });
      }

      if (incidentType === "Other" && !otherDescription) {
        return res.status(400).json({
          message:
            'Other description is required when incident type is "Other".',
        });
      }

      const incident = await Incident.findById(incidentId);
      if (!incident)
        return res.status(404).json({ message: "Incident not found." });

      if (incident.responsibleUser._id.toString() !== studentId) {
        return res.status(403).json({
          message:
            "You are not authorized to submit a report for this incident.",
        });
      }

      const existingReport = await StudentIncidentReport.findOne({
        incidentId,
        studentId,
      });

      if (existingReport) {
        if (
          existingReport.status === "Submitted" ||
          existingReport.status === "Pending Review"
        ) {
          return res
            .status(409)
            .json({
              message: "A report for this incident has already been submitted.",
            });
        }
        if (existingReport.status === "Overdue") {
          return res
            .status(403)
            .json({
              message: "This report is overdue and cannot be submitted.",
            });
        }

        const isResubmission = existingReport.status === "Rejected";

        existingReport.equipmentId = equipmentId;
        existingReport.dateOfIncident = new Date(dateOfIncident);
        existingReport.incidentType = incidentType;
        existingReport.detailedDescription = detailedDescription;
        existingReport.otherDescription = otherDescription || undefined;
        existingReport.damageDescription = damageDescription || undefined;
        existingReport.replacementAction = replacementAction || undefined;
        existingReport.replacedItems = replacedItems || undefined;
        existingReport.submittedAt = new Date();
        existingReport.status = "Submitted";

        await existingReport.save();

        incident.studentReportId = existingReport._id;
        await incident.save();

        const notification = new Notification({
          userId: studentId,
          title: isResubmission
            ? "Incident Report Resubmitted"
            : "Incident Report Submitted",
          message: isResubmission
            ? `Your incident report has been resubmitted and is pending Admin 2 review.`
            : `Your incident report has been submitted and is pending Admin 2 review.`,
        });
        await notification.save();

        const admin2 = await User.findOne({ username: "admin2" });
        if (admin2) {
          const adminNotification = new Notification({
            userId: admin2._id,
            title: isResubmission
              ? "Student Incident Report Resubmitted"
              : "New Student Incident Report",
            message: isResubmission
              ? `A student has resubmitted an incident report (LF-05) that was previously rejected. Please review.`
              : `A student has submitted an incident report (LF-05). Please review.`,
          });
          await adminNotification.save();
        }

        broadcastRefresh();
        res.status(200).json({
          message: isResubmission
            ? "Incident report resubmitted successfully."
            : "Incident report submitted successfully.",
          report: existingReport,
        });
      } else {
        const newReport = new StudentIncidentReport({
          incidentId,
          studentId,
          equipmentId,
          dateOfIncident: new Date(dateOfIncident),
          incidentType,
          detailedDescription,
          otherDescription:
            incidentType === "Other" ? otherDescription : undefined,
          damageDescription: damageDescription || undefined,
          replacementAction: replacementAction || undefined,
          replacedItems: replacedItems || undefined,
          submittedAt: new Date(),
          deadlineAt:
            incident.deadlineAt || new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: "Submitted",
        });
        await newReport.save();

        incident.studentReportId = newReport._id;
        await incident.save();

        const notification = new Notification({
          userId: studentId,
          title: "Incident Report Submitted",
          message: `Your incident report has been submitted and is pending Admin 2 review.`,
        });
        await notification.save();

        const admin2 = await User.findOne({ username: "admin2" });
        if (admin2) {
          const adminNotification = new Notification({
            userId: admin2._id,
            title: "New Student Incident Report",
            message: `A student has submitted an incident report (LF-05). Please review.`,
          });
          await adminNotification.save();
        }

        broadcastRefresh();
        res.status(201).json({
          message: "Incident report submitted successfully.",
          report: newReport,
        });
      }
    } catch (error) {
      console.error("Error submitting incident report:", error);
      res.status(500).json({ message: "Error submitting incident report." });
    }
  },
);

// GET /api/student-suspension-status (check suspension status)
router.get(
  "/api/student-suspension-status",
  isAuthenticated,
  async (req, res) => {
    try {
      const user = await User.findById(req.session.user.id).select(
        "isSuspended suspensionReason suspensionDate",
      );
      if (!user) return res.status(404).json({ message: "User not found." });
      res.json({
        isSuspended: user.isSuspended || false,
        suspensionReason: user.suspensionReason || null,
        suspensionDate: user.suspensionDate || null,
      });
    } catch (error) {
      console.error("Error checking suspension status:", error);
      res.status(500).json({ message: "Error checking suspension status." });
    }
  },
);

// GET /api/admin2/incident-reports (admin dashboard listing)
router.get("/api/admin2/incident-reports", isAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.user.username.toLowerCase();
    if (adminUsername !== "admin2") {
      return res
        .status(403)
        .json({ message: "Only Admin 2 can access this endpoint." });
    }

    const reports = await StudentIncidentReport.find({})
      .populate("incidentId")
      .populate("studentId", "firstName lastName studentID")
      .sort({ submittedAt: -1 });

    const formattedReports = reports.map((report) => {
      const studentName = report.studentId
        ? `${report.studentId.firstName || ""} ${report.studentId.lastName || ""}`.trim()
        : "Unknown Student";
      const studentID = report.studentId?.studentID || "N/A";
      const itemName =
        report.incidentId?.damagedItemInfo?.name || report.equipmentId || "N/A";

      return {
        _id: report._id,
        studentName,
        studentID,
        itemId: report.equipmentId,
        incidentType: report.incidentType,
        dateOfIncident: report.dateOfIncident,
        dateSubmitted: report.submittedAt,
        status: report.status,
        incidentId: report.incidentId?._id || null,
        itemName,
      };
    });

    res.json(formattedReports);
  } catch (error) {
    console.error("Error fetching incident reports:", error);
    res.status(500).json({ message: "Error fetching incident reports." });
  }
});

// GET /api/admin2/incident-reports/:id (admin dashboard details)
router.get("/api/admin2/incident-reports/:id", isAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.user.username.toLowerCase();
    if (adminUsername !== "admin2") {
      return res
        .status(403)
        .json({ message: "Only Admin 2 can access this endpoint." });
    }

    const report = await StudentIncidentReport.findById(req.params.id)
      .populate("incidentId")
      .populate("studentId", "firstName lastName studentID email");

    if (!report) return res.status(404).json({ message: "Report not found." });

    const studentName = report.studentId
      ? `${report.studentId.firstName || ""} ${report.studentId.lastName || ""}`.trim()
      : "Unknown Student";
    const studentID = report.studentId?.studentID || "N/A";
    const studentEmail = report.studentId?.email || "N/A";

    const itemName =
      report.incidentId?.damagedItemInfo?.name || report.equipmentId || "N/A";
    const itemId =
      report.incidentId?.damagedItemInfo?.itemId || report.equipmentId || "N/A";

    res.json({
      _id: report._id,
      student: { name: studentName, studentID, email: studentEmail },
      item: { name: itemName, itemId },
      equipmentId: report.equipmentId,
      dateOfIncident: report.dateOfIncident,
      incidentType: report.incidentType,
      detailedDescription: report.detailedDescription,
      otherDescription: report.otherDescription,
      replacedItems: report.replacedItems || null,
      damageDescription: report.damageDescription || null,
      replacementAction: report.replacementAction || null,
      returnDuration: report.returnDuration || null,
      itemConditionOnReturn: report.itemConditionOnReturn || null,
      replacementStatus: report.replacementStatus || null,
      replacementDate: report.replacementDate || null,
      submittedAt: report.submittedAt,
      status: report.status,
      incidentId: report.incidentId?._id || null,
      replacementItemId: report.replacementItemId || null,
      admin2ReviewNotes: report.admin2ReviewNotes || null,
      resolvedAt: report.resolvedAt || null,
    });
  } catch (error) {
    console.error("Error fetching incident report:", error);
    res.status(500).json({ message: "Error fetching incident report." });
  }
});

// PUT /api/admin2/incident-reports/:id/resolve
router.put(
  "/api/admin2/incident-reports/:id/resolve",
  isAdmin,
  async (req, res) => {
    try {
      const adminUsername = req.session.user.username.toLowerCase();
      if (adminUsername !== "admin2") {
        return res
          .status(403)
          .json({ message: "Only Admin 2 can access this endpoint." });
      }

      const { replacementItemId, resolutionNote } = req.body;
      if (!replacementItemId || !resolutionNote) {
        return res
          .status(400)
          .json({
            message: "Replacement item ID and resolution note are required.",
          });
      }

      const report = await StudentIncidentReport.findById(req.params.id)
        .populate("incidentId")
        .populate("studentId");

      if (!report)
        return res.status(404).json({ message: "Report not found." });

      if (report.status === "Resolved" || report.status === "Rejected") {
        return res
          .status(409)
          .json({ message: "This report has already been processed." });
      }

      report.status = "Resolved";
      report.resolvedAt = new Date();
      report.replacementItemId = replacementItemId;
      report.admin2ReviewNotes = resolutionNote;
      await report.save();

      const incident = report.incidentId;
      incident.status = "Resolved";
      incident.dateResolved = new Date();
      incident.resolutionNotes = resolutionNote;
      incident.replacementItemId = replacementItemId;
      await incident.save();

      const studentNotification = new Notification({
        userId: report.studentId._id,
        title: "Incident Report Resolved",
        message: `Your incident report has been resolved by Admin 2. Replacement item: ${replacementItemId}`,
      });
      await studentNotification.save();

      const student = await User.findById(report.studentId._id);
      if (student && student.email) {
        const emailSubject = "✅ Incident Report Resolved";
        const emailBody = `
        <p>Hello ${student.firstName},</p>
        <p>Your incident report has been **RESOLVED** by Admin 2.</p>
        <p><strong>Replacement Item ID:</strong> ${replacementItemId}</p>
        <p><strong>Resolution Note:</strong> ${resolutionNote}</p>
        <p>Thank you for your cooperation.</p>
        <p><em>LabLinx DLSU-D Team.</em></p>
      `;
        await sendEmail(student.email, emailSubject, emailBody);
      }

      await logAdminAction(
        req,
        "Resolve Incident Report",
        `Resolved incident report ${report._id} with replacement item ${replacementItemId}.`,
      );

      broadcastRefresh();
      res.json({ message: "Incident report resolved successfully.", report });
    } catch (error) {
      console.error("Error resolving incident report:", error);
      res.status(500).json({ message: "Error resolving incident report." });
    }
  },
);

// PUT /api/admin2/incident-reports/:id/reject
router.put(
  "/api/admin2/incident-reports/:id/reject",
  isAdmin,
  async (req, res) => {
    try {
      const adminUsername = req.session.user.username.toLowerCase();
      if (adminUsername !== "admin2") {
        return res
          .status(403)
          .json({ message: "Only Admin 2 can access this endpoint." });
      }

      const { rejectionNote } = req.body;

      const report = await StudentIncidentReport.findById(req.params.id)
        .populate("incidentId")
        .populate("studentId");

      if (!report)
        return res.status(404).json({ message: "Report not found." });

      if (report.status === "Resolved" || report.status === "Rejected") {
        return res
          .status(409)
          .json({ message: "This report has already been processed." });
      }

      report.status = "Rejected";
      report.admin2ReviewNotes = rejectionNote || "Report rejected by Admin 2.";
      await report.save();

      const notificationMessage = rejectionNote
        ? `Your incident report has been rejected by Admin 2.\n\nReason: ${rejectionNote}\n\nPlease contact the lab administrator for more information.`
        : `Your incident report has been rejected by Admin 2. Please contact the lab administrator for more information.`;

      const studentNotification = new Notification({
        userId: report.studentId._id,
        title: "Incident Report Rejected",
        message: notificationMessage,
      });
      await studentNotification.save();

      const student = await User.findById(report.studentId._id);
      if (student && student.email) {
        const emailSubject = "❌ Incident Report Rejected";
        const emailBody = `
        <p>Hello ${student.firstName},</p>
        <p>Your incident report has been **REJECTED** by Admin 2.</p>
        ${rejectionNote ? `<p><strong>Reason:</strong> ${rejectionNote}</p>` : ""}
        <p>Please contact the lab administrator for more information.</p>
        <p><em>LabLinx DLSU-D Team.</em></p>
      `;
        await sendEmail(student.email, emailSubject, emailBody);
      }

      await logAdminAction(
        req,
        "Reject Incident Report",
        `Rejected incident report ${report._id} by Admin 2. Reason: ${rejectionNote || "None specified"}`,
      );

      broadcastRefresh();
      res.json({ message: "Incident report rejected successfully.", report });
    } catch (error) {
      console.error("Error rejecting incident report:", error);
      res.status(500).json({ message: "Error rejecting incident report." });
    }
  },
);

// PUT /api/admin2/incident-reports/:id/update-replacement
router.put(
  "/api/admin2/incident-reports/:id/update-replacement",
  isAdmin,
  async (req, res) => {
    try {
      const {
        replacedItems,
        damageDescription,
        replacementAction,
        replacementStatus,
        itemConditionOnReturn,
        replacementDate,
      } = req.body;

      const replacementReturnDays = await getSettingValue(
        "replacement_return_days",
      );

      const report = await StudentIncidentReport.findById(req.params.id);
      if (!report)
        return res.status(404).json({ message: "Report not found." });

      if (replacedItems !== undefined) report.replacedItems = replacedItems;
      if (damageDescription !== undefined)
        report.damageDescription = damageDescription;
      if (replacementAction !== undefined)
        report.replacementAction = replacementAction;
      if (replacementStatus !== undefined)
        report.replacementStatus = replacementStatus;
      if (itemConditionOnReturn !== undefined)
        report.itemConditionOnReturn = itemConditionOnReturn;
      if (replacementDate) report.replacementDate = new Date(replacementDate);

      if (report.replacementDate && report.dateOfIncident) {
        report.returnDuration = Math.ceil(
          (report.replacementDate.getTime() - report.dateOfIncident.getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }

      await report.save();

      await logAdminAction(
        req,
        "Update Incident Report",
        `Updated replacement info for incident report ${report._id}.`,
      );
      broadcastRefresh();
      res.json({
        message: "Incident report updated.",
        report,
        replacementReturnDays,
      });
    } catch (error) {
      console.error("Incident Report Update Error:", error);
      res.status(500).json({ message: "Error updating incident report." });
    }
  },
);

module.exports = router;
