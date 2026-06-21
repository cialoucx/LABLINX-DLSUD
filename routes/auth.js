const express = require("express");
const bcrypt = require("bcryptjs");
const passport = require("passport");
const User = require("../models/User");
const Notification = require("../models/Notification");
const {
  isEmailDomainAllowed,
  getAllowedEmailDomains,
} = require("../config/constants");

const router = express.Router();

// Brute-force lockout state
const loginAttempts = new Map();

const getLoginAttemptKey = (username) => {
  return String(username || "")
    .trim()
    .toLowerCase();
};

const getRemainingLockMs = (key) => {
  const record = loginAttempts.get(key);
  if (!record || !record.lockedUntil) return 0;
  const remainingMs = record.lockedUntil.getTime() - Date.now();
  if (remainingMs <= 0) {
    loginAttempts.delete(key);
    return 0;
  }
  return remainingMs;
};

const recordFailedLogin = (key) => {
  const maxAttempts = Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS || 8);
  const lockoutMinutes = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

  const current = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  current.count += 1;
  if (current.count >= maxAttempts) {
    current.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
  }
  loginAttempts.set(key, current);
};

const clearFailedLogin = (key) => {
  loginAttempts.delete(key);
};

// POST /login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const attemptKey = getLoginAttemptKey(username);

  const remainingLockMs = getRemainingLockMs(attemptKey);
  if (remainingLockMs > 0) {
    const remainingMinutes = Math.ceil(remainingLockMs / (60 * 1000));
    return res
      .status(429)
      .send(
        `Too many failed login attempts. Try again in ${remainingMinutes} minute(s).`,
      );
  }

  try {
    const user = await User.findOne({
      username: new RegExp(`^${username}$`, "i"),
    });

    if (!user || !user.password) {
      recordFailedLogin(attemptKey);
      return res
        .status(401)
        .send("Invalid credentials. Students must use Microsoft login.");
    }

    if (!(await bcrypt.compare(password, user.password))) {
      recordFailedLogin(attemptKey);
      return res.status(401).send("Invalid credentials.");
    }

    clearFailedLogin(attemptKey);

    if (user.status === "Pending") {
      return res
        .status(403)
        .send("Your account is pending admin approval. You cannot log in yet.");
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      role: user.role,
      fullName: `${user.firstName} ${user.lastName}`,
    };

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Server error during login.");
      }
      if (user.role === "admin") {
        const adminUsername = user.username.toLowerCase();
        if (adminUsername === "admin3") return res.redirect("/admin3");
        if (adminUsername === "admin2") return res.redirect("/admin2");
        if (adminUsername === "admin4") return res.redirect("/admin4");
        return res.redirect("/admin");
      } else {
        return res.redirect("/dashboard");
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).send("Server error during login.");
  }
});

// POST /register
router.post("/register", async (req, res) => {
  try {
    const {
      lastName,
      firstName,
      username,
      studentID,
      email,
      gradeLevel,
      role,
    } = req.body;

    if (email && !isEmailDomainAllowed(email)) {
      return res
        .status(400)
        .send(
          `Registration failed: Email must end with any of the allowed domains (${getAllowedEmailDomains().join(
            ", ",
          )}).`,
        );
    }

    if (
      !lastName ||
      !firstName ||
      !username ||
      !studentID ||
      !email ||
      !gradeLevel ||
      !role
    ) {
      return res.status(400).send("All fields are required.");
    }

    const existingUser = await User.findOne({
      $or: [
        { username: new RegExp(`^${username}$`, "i") },
        { email: new RegExp(`^${email}$`, "i") },
        { studentID: new RegExp(`^${studentID}$`, "i") },
      ],
    });
    if (existingUser) {
      return res
        .status(409)
        .send("User with this Username, Email, or Student ID already exists.");
    }

    const newUser = new User({
      lastName,
      firstName,
      username,
      studentID,
      email,
      gradeLevel,
      role,
      status: "Pending",
    });
    await newUser.save();

    const superAdmin = await User.findOne({ username: "admin2" });
    if (superAdmin) {
      const adminNotification = new Notification({
        userId: superAdmin._id,
        title: "New User Registration",
        message: `A new user, ${username} (Role: ${role}), has registered and is awaiting approval.`,
      });
      await adminNotification.save();
    }

    res
      .status(201)
      .send(
        "Registration successful! Your account is now pending for admin approval.",
      );
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).send("Server error during registration.");
  }
});

// GET /logout
router.get("/logout", (req, res, next) => {
  const postLogoutRedirectUri = `${req.protocol}://${req.get("host")}`;
  const tenantID = process.env.MICROSOFT_TENANT_ID;

  const isStudentOrFaculty =
    req.session.user &&
    (req.session.user.role === "student" ||
      req.session.user.role === "faculty");

  req.logout(function (err) {
    if (err) {
      console.error("Passport logout error:", err);
      return next(err);
    }

    req.session.destroy((err) => {
      if (err) {
        console.error("Session destruction error:", err);
      }

      if (isStudentOrFaculty && tenantID) {
        const loginRedirectUri = `${postLogoutRedirectUri}/login`;
        const msLogoutUrlWithLogin = `https://login.microsoftonline.com/${tenantID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(
          loginRedirectUri,
        )}`;
        res.redirect(msLogoutUrlWithLogin);
      } else {
        res.redirect("/login");
      }
    });
  });
});

// GET /auth/microsoft
router.get(
  "/auth/microsoft",
  (req, res, next) => {
    if (!passport._strategies || !passport._strategies.microsoft) {
      console.warn("ℹ️ Microsoft SSO strategy is not registered. Redirecting to login with error.");
      return res.redirect("/login?error=ms_sso_disabled");
    }
    next();
  },
  passport.authenticate("microsoft", {
    prompt: "select_account",
  }),
);

// GET /auth/microsoft/callback
router.get(
  "/auth/microsoft/callback",
  (req, res, next) => {
    if (!passport._strategies || !passport._strategies.microsoft) {
      return res.redirect("/login?error=ms_sso_disabled");
    }
    next();
  },
  passport.authenticate("microsoft", {
    failureRedirect: "/?error=ms_login_failed",
  }),
  (req, res) => {
    const user = req.user;
    if (!user) return res.redirect("/login");

    req.session.user = {
      id: user._id,
      username: user.username,
      role: user.role,
      fullName: `${user.firstName} ${user.lastName}`,
    };

    req.session.save((err) => {
      if (err) {
        console.error("Session save error post-MSAL:", err);
        return res.status(500).send("Session error.");
      }
      res.redirect("/dashboard");
    });
  },
);

module.exports = router;
