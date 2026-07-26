const cron = require("node-cron");
const ItemRequest = require("../models/ItemRequest");
const User = require("../models/User");
const StudentIncidentReport = require("../models/StudentIncidentReport");
const Notification = require("../models/Notification");
const { sendEmail } = require("./email");
const { broadcastRefresh } = require("./websocket");

const initCronJobs = () => {
  if (process.env.VERCEL) {
    console.log(
      "[CRON] Serverless environment (Vercel) detected. node-cron schedules disabled.",
    );
    return;
  }
  cron.schedule("0 0 8 * * *", async () => {
    console.log("[CRON] Running daily due date reminder checks...");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const oneDayFromNow = new Date(today);
    oneDayFromNow.setDate(today.getDate() + 1);

    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(today.getDate() + 3);

    try {
      const dueSoonRequests = await ItemRequest.find({
        status: "Approved",
        dueDate: { $gte: oneDayFromNow, $lt: threeDaysFromNow },
      })
        .populate("studentId", "firstName email")
        .exec();

      for (const request of dueSoonRequests) {
        if (!request.studentId || !request.studentId.email) continue;
        const dueDateStr = new Date(request.dueDate).toLocaleDateString();
        const emailSubject = `ITEM DUE SOON: ${request.itemName} (Due: ${dueDateStr})`;
        const emailBody = `
          <p>Hello ${request.studentId.firstName},</p>
          <p>This is a friendly reminder that the item **${request.quantity}x ${request.itemName}** you borrowed is due between **1 to 2 days** from now on **${dueDateStr}**.</p>
          <p>Please prepare to return the item to the lab office soon.</p>
          <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
        `;
        await sendEmail(request.studentId.email, emailSubject, emailBody);
      }
      console.log(
        `[CRON] Due Soon check complete. Sent ${dueSoonRequests.length} reminders.`,
      );

      const overdueRequests = await ItemRequest.find({
        status: "Approved",
        dueDate: { $lt: today },
      })
        .populate("studentId", "firstName email")
        .exec();

      for (const request of overdueRequests) {
        if (!request.studentId || !request.studentId.email) continue;
        const dueDateStr = new Date(request.dueDate).toLocaleDateString();
        const emailSubject = `URGENT: ITEM OVERDUE! (${request.itemName})`;
        const emailBody = `
          <p>Dear ${request.studentId.firstName},</p>
          <p>This is an <strong>URGENT REMINDER</strong> that the item <strong>${request.quantity}x ${request.itemName}</strong> was due on <strong>${dueDateStr}</strong> and is now <strong>OVERDUE</strong>.</p>
          <p>Please return it to the laboratory office immediately to avoid further penalties or account actions.</p>
          <p><em>LabLinx DLSU-D Team.</em></p>
        `;
        await sendEmail(request.studentId.email, emailSubject, emailBody);
      }
      console.log(
        `[CRON] Overdue check complete. Sent ${overdueRequests.length} overdue notices.`,
      );

      if (dueSoonRequests.length > 0 || overdueRequests.length > 0) {
        broadcastRefresh();
      }
    } catch (error) {
      console.error("[CRON ERROR] Due Date Reminder Scheduler Error:", error);
    }
  });

  cron.schedule("0 * * * *", async () => {
    console.log("[CRON] Running hourly incident report compliance monitor...");
    try {
      const now = new Date();
      const overdueReports = await StudentIncidentReport.find({
        status: "Pending Submission",
        deadlineAt: { $lt: now },
      }).populate("studentId");

      for (const report of overdueReports) {
        const student = report.studentId;
        if (!student) continue;

        student.isSuspended = true;
        student.suspensionReason =
          "Failed to submit incident report within 48 hours";
        student.suspensionDate = new Date();
        await student.save();

        report.status = "Overdue";
        await report.save();

        const notification = new Notification({
          userId: student._id,
          title: "Account Suspended - Incident Report Overdue",
          message:
            "You have been suspended from borrowing equipment due to failure to submit an incident report within 48 hours. Please contact the lab administrator.",
        });
        await notification.save();

        console.log(
          `[CRON] Student ${student.username} suspended due to overdue incident report.`,
        );
      }

      if (overdueReports.length > 0) {
        broadcastRefresh();
      }
    } catch (error) {
      console.error("[CRON ERROR] Hourly Incident Report Cron Error:", error);
    }
  });
};

module.exports = { initCronJobs };
