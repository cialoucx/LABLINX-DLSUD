const express = require("express");
const bcrypt = require("bcryptjs");
const { isAuthenticated, isSuperAdmin } = require("../middleware/auth");
const User = require("../models/User");
const ProfileUpdateRequest = require("../models/ProfileUpdateRequest");
const Notification = require("../models/Notification");
const Incident = require("../models/Incident");
const {
  isEmailDomainAllowed,
  getAllowedEmailDomains,
} = require("../config/constants");
const { broadcastRefresh } = require("../utils/websocket");
const { logAdminAction } = require("./helpers");
const { sendEmail } = require("../utils/email");

const router = express.Router();

// GET /api/current-user
router.get("/api/current-user", isAuthenticated, async (req, res) => {
  // Prevent browser from caching this response — stale 304 responses from a
  // previous session would return the wrong user object after re-login.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  try {
    const user = await User.findById(req.session.user.id)
      .select("-password")
      .lean();
    if (!user) return res.status(404).send("User not found");
    user.fullName = `${user.firstName} ${user.lastName}`;

    const pendingIncident = await Incident.findOne({
      "responsibleUser._id": user._id,
      status: "Pending Replacement",
    });
    user.hasPendingIncident = !!pendingIncident;
    if (pendingIncident) {
      user.pendingIncidentMessage = `You have an unresolved incident (Damaged Item: ${pendingIncident.damagedItemInfo.name}). Please see the lab admin.`;
    }

    res.json(user);
  } catch (error) {
    res.status(500).send("Server error");
  }
});

// GET /api/all-users
router.get(
  "/api/all-users",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const users = await User.find({}).select("-password");
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Error fetching user data." });
    }
  },
);

// POST /api/users (Superadmin create user)
router.post("/api/users", isAuthenticated, isSuperAdmin, async (req, res) => {
  try {
    const {
      lastName,
      firstName,
      username,
      studentID,
      email,
      gradeLevel,
      password,
      role,
    } = req.body;

    const existingUser = await User.findOne({
      $or: [{ username }, { email }, { studentID }],
    });
    if (existingUser) {
      return res
        .status(409)
        .send("User with this Username, Email, or Student ID already exists.");
    }

    let hashedPassword = null;
    if (password && role === "admin") {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const status = role === "admin" ? "Approved" : "Pending";
    const finalGradeLevel = role === "student" ? gradeLevel || "N/A" : "N/A";

    const newUser = new User({
      lastName,
      firstName,
      username,
      studentID,
      email,
      gradeLevel: finalGradeLevel,
      password: hashedPassword,
      role,
      status,
    });
    await newUser.save();

    await logAdminAction(
      req,
      "Create User",
      `Created user '${username}' with role '${role}'.`,
    );

    broadcastRefresh();
    res.status(201).json({ message: "User created successfully." });
  } catch (error) {
    res.status(500).send("Server error during user creation.");
  }
});

// PUT /api/users/:id/role
router.put(
  "/api/users/:id/role",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const { role } = req.body;
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { role },
        { new: true },
      );
      if (!user) return res.status(404).send("User not found.");

      await logAdminAction(
        req,
        "Update User Role",
        `Changed role for '${user.username}' to '${role}'.`,
      );

      res.json({ message: "User role updated." });
    } catch (error) {
      res.status(500).send("Error updating user role.");
    }
  },
);

// PUT /api/users/:id/reset-password
router.put(
  "/api/users/:id/reset-password",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword)
        return res.status(400).send("New password is required.");

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const user = await User.findByIdAndUpdate(req.params.id, {
        password: hashedPassword,
      });
      if (!user) return res.status(404).send("User not found.");

      await logAdminAction(
        req,
        "Reset User Password",
        `Reset password for user '${user.username}'.`,
      );

      broadcastRefresh();
      res.json({ message: "User password reset successfully." });
    } catch (error) {
      res.status(500).send("Error resetting password.");
    }
  },
);

// DELETE /api/users/:id
router.delete(
  "/api/users/:id",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      if (!user) return res.status(404).send("User not found.");

      await logAdminAction(
        req,
        "Delete User",
        `Deleted user '${user.username}'.`,
      );

      await Incident.deleteMany({ "responsibleUser._id": user._id });

      broadcastRefresh();
      res.json({ message: "User deleted successfully." });
    } catch (error) {
      res.status(500).send("Error deleting user.");
    }
  },
);

// GET /api/profile-update-requests
router.get(
  "/api/profile-update-requests",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const requests = await ProfileUpdateRequest.find({
        status: "Pending",
      }).sort({ requestedAt: -1 });
      res.json(requests);
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error fetching profile update requests." });
    }
  },
);

// PUT /api/profile-update-requests/:id/approve
router.put(
  "/api/profile-update-requests/:id/approve",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const request = await ProfileUpdateRequest.findById(req.params.id);
      if (!request || request.status !== "Pending") {
        return res.status(404).json({
          message: "Request not found or has already been processed.",
        });
      }

      const userToUpdate = await User.findByIdAndUpdate(
        request.userId,
        {
          firstName: request.newFirstName,
          lastName: request.newLastName,
          email: request.newEmail,
        },
        { new: true },
      );

      if (!userToUpdate) {
        request.status = "Rejected";
        await request.save();
        return res.status(404).json({
          message: "User to update not found. Request has been rejected.",
        });
      }

      request.status = "Approved";
      await request.save();

      await logAdminAction(
        req,
        "Approve Profile Update",
        `Approved profile update for ${userToUpdate.username}.`,
      );

      const studentNotification = new Notification({
        userId: request.userId,
        title: "Profile Update Approved",
        message:
          "Your request to update your profile information has been approved.",
      });
      await studentNotification.save();

      broadcastRefresh();
      res.json({
        message: "Profile update approved and user details updated.",
      });
    } catch (error) {
      res.status(500).json({ message: "Server error during approval." });
    }
  },
);

// PUT /api/profile-update-requests/:id/reject
router.put(
  "/api/profile-update-requests/:id/reject",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const request = await ProfileUpdateRequest.findByIdAndUpdate(
        req.params.id,
        { status: "Rejected" },
        { new: true },
      );
      if (!request)
        return res.status(404).json({ message: "Request not found." });

      await logAdminAction(
        req,
        "Reject Profile Update",
        `Rejected profile update for user ID ${request.userId}.`,
      );

      const studentNotification = new Notification({
        userId: request.userId,
        title: "Profile Update Rejected",
        message:
          "Your request to update your profile information has been rejected.",
      });
      await studentNotification.save();

      broadcastRefresh();
      res.json({ message: "Profile update request rejected." });
    } catch (error) {
      res.status(500).json({ message: "Server error during rejection." });
    }
  },
);

// GET /api/pending-registrations
router.get(
  "/api/pending-registrations",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const pendingUsers = await User.find({
        status: "Pending",
        role: { $ne: "admin" },
      }).sort({ _id: -1 });
      res.json(pendingUsers);
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error fetching pending registrations." });
    }
  },
);

// PUT /api/registrations/:userId/approve
router.put(
  "/api/registrations/:userId/approve",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { status: "Approved" },
        { new: true },
      );
      if (!user) return res.status(404).json({ message: "User not found." });

      await logAdminAction(
        req,
        "Approve Registration",
        `Approved registration for user '${user.username}'.`,
      );

      const studentNotification = new Notification({
        userId: user._id,
        title: "Account Approved",
        message:
          "Welcome to LabLinx! Your registration has been approved, and you can now log in.",
      });
      await studentNotification.save();

      if (user.email) {
        const emailSubject = "🎉 Your LabLinx Account Has Been Approved!";
        const port = process.env.PORT || 3000;
        const emailBody = `
        <p>Hello ${user.firstName},</p>
        <p>We are pleased to inform you that your LabLinx DLSU-D account has been **APPROVED** by the administrator.</p>
        <p>You can now log in and start requesting laboratory equipment and materials.</p>
        <p><strong>Username:</strong> ${user.username}</p>
        <p>Click here to log in: <a href="${process.env.BASE_URL || `http://localhost:${port}`}">Log In to LabLinx</a></p>
        <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
      `;
        await sendEmail(user.email, emailSubject, emailBody);
      }

      broadcastRefresh();
      res.json({ message: `User ${user.username} has been approved.` });
    } catch (error) {
      res.status(500).json({ message: "Server error during approval." });
    }
  },
);

// DELETE /api/registrations/:userId/reject
router.delete(
  "/api/registrations/:userId/reject",
  isAuthenticated,
  isSuperAdmin,
  async (req, res) => {
    try {
      const user = await User.findByIdAndDelete(req.params.userId);
      if (!user) return res.status(404).json({ message: "User not found." });

      await logAdminAction(
        req,
        "Reject Registration",
        `Rejected and deleted registration for user '${user.username}'.`,
      );

      if (user.email) {
        const emailSubject = "🚫 LabLinx Account Registration Rejected";
        const emailBody = `
        <p>Hello ${user.firstName},</p>
        <p>We regret to inform you that your LabLinx DLSU-D account registration was **REJECTED** by the administrator. This may be due to incorrect information or missing details.</p>
        <p>Please re-register with the correct information.</p>
        <p><em>Thank you, LabLinx DLSU-D Team.</em></p>
      `;
        await sendEmail(user.email, emailSubject, emailBody);
      }

      broadcastRefresh();
      res.json({
        message: `Registration for ${user.username} has been rejected and deleted.`,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error during rejection." });
    }
  },
);

// POST /api/account/request-update (profile update request)
router.post(
  "/api/account/request-update",
  isAuthenticated,
  async (req, res) => {
    try {
      const { firstName, lastName, email } = req.body;

      if (email && !isEmailDomainAllowed(email)) {
        return res.status(400).json({
          message: `Update failed: Email must end with any of the allowed domains (${getAllowedEmailDomains().join(
            ", ",
          )}).`,
        });
      }

      const userId = req.session.user.id;
      const user = await User.findById(userId);

      if (!user) return res.status(404).json({ message: "User not found." });

      const existingPendingRequest = await ProfileUpdateRequest.findOne({
        userId,
        status: "Pending",
      });
      if (existingPendingRequest) {
        return res.status(409).json({
          message: "You already have a pending profile update request.",
        });
      }

      const newRequest = new ProfileUpdateRequest({
        userId,
        username: user.username,
        currentFullName: `${user.firstName} ${user.lastName}`,
        newFirstName: firstName,
        newLastName: lastName,
        newEmail: email,
      });

      await newRequest.save();

      const superAdmin = await User.findOne({ username: "admin2" });
      if (superAdmin) {
        const adminNotification = new Notification({
          userId: superAdmin._id,
          title: "Profile Update Request",
          message: `User ${user.username} has requested to update their profile.`,
        });
        await adminNotification.save();
      }

      res.status(201).json({
        message:
          "Profile update request submitted successfully. It is now pending for admin approval.",
      });
    } catch (error) {
      if (error.code === 11000) {
        return res
          .status(409)
          .json({
            message: "This email is already in use by another account.",
          });
      }
      console.error("Profile Update Request Error:", error);
      res
        .status(500)
        .json({ message: "Server error while submitting your request." });
    }
  },
);

// PUT /api/account/password (password update request)
router.put("/api/account/password", isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).send("Current and new passwords are required.");
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found.");

    if (!user.password) {
      return res
        .status(403)
        .send(
          "Password cannot be changed for this account. Please use Microsoft login.",
        );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).send("Incorrect current password.");

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.send("Password updated successfully.");
  } catch (error) {
    console.error("Password Update Error:", error);
    res.status(500).send("Server error while updating password.");
  }
});

module.exports = router;
