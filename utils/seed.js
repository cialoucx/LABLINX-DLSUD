const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const {
  DEFAULT_SYSTEM_SETTINGS: DEFAULT_SYSTEM_SETTINGS,
  adminCategoryMapping: adminCategoryMapping,
} = require("../config/constants");
function getSeedPassword(envVarName) {
  if (process.env[envVarName]) {
    return process.env[envVarName];
  }
  if (process.env.SEED_DEFAULT_PASSWORD) {
    return process.env.SEED_DEFAULT_PASSWORD;
  }
  return crypto.randomBytes(12).toString("hex");
}
function getScopedSettingKey(settingKey, adminUsername) {
  return settingKey;
}
async function setupDefaultAdmins() {
  const saltRounds = 10;
  const admins = [
    {
      username: "admin",
      password: getSeedPassword("SEED_ADMIN1_PASSWORD"),
      firstName: "General",
      lastName: "Admin",
      studentID: "0000-ADMIN",
      email: process.env.SEED_ADMIN1_EMAIL || "admin@dlsud.edu.ph",
    },
    {
      username: "admin2",
      password: getSeedPassword("SEED_ADMIN2_PASSWORD"),
      firstName: "Science",
      lastName: "Admin",
      studentID: "0001-ADMIN",
      email: process.env.SEED_ADMIN2_EMAIL || "admin2@dlsud.edu.ph",
    },
    {
      username: "admin3",
      password: getSeedPassword("SEED_ADMIN3_PASSWORD"),
      firstName: "Facility",
      lastName: "Admin",
      studentID: "0002-ADMIN",
      email: process.env.SEED_ADMIN3_EMAIL || "admin3@dlsud.edu.ph",
    },
    {
      username: "admin4",
      password: getSeedPassword("SEED_ADMIN4_PASSWORD"),
      firstName: "Robotics",
      lastName: "Admin",
      studentID: "0003-ADMIN",
      email: process.env.SEED_ADMIN4_EMAIL || "admin4@dlsud.edu.ph",
    },
  ];
  for (const adminData of admins) {
    try {
      const adminExists = await User.findOne({
        studentID: adminData.studentID,
      });
      if (!adminExists) {
        const hashedPassword = await bcrypt.hash(
          adminData.password,
          saltRounds,
        );
        const newAdmin = new User({
          ...adminData,
          password: hashedPassword,
          gradeLevel: "N/A",
          role: "admin",
          status: "Approved",
        });
        await newAdmin.save();
        console.log(`[SEED] Admin user '${adminData.username}' initialized.`);
      } else {
        let patched = false;
        if (adminExists.role !== "admin") {
          adminExists.role = "admin";
          patched = true;
        }
        if (adminExists.status !== "Approved") {
          adminExists.status = "Approved";
          patched = true;
        }
        if (patched) {
          await adminExists.save();
          console.log(
            `[SEED] Updated permissions for admin user '${adminData.username}'.`,
          );
        } else {
          console.log(`[SEED] Admin user '${adminData.username}' exists.`);
        }
      }
    } catch (error) {
      console.error(
        `[SEED ERROR] Admin user '${adminData.username}':`,
        error.message,
      );
    }
  }
}
async function setupDefaultSettings() {
  try {
    const baseDefaults = Object.entries(DEFAULT_SYSTEM_SETTINGS).map(
      ([key, value]) => ({ key: key, value: value }),
    );
    for (const setting of baseDefaults) {
      const existing = await SystemSettings.findOne({ key: setting.key });
      if (!existing) {
        await SystemSettings.create(setting);
        console.log(`[SEED] Setting '${setting.key}' created.`);
      }
    }
    const adminUsernames = Object.keys(adminCategoryMapping);
    for (const adminUsername of adminUsernames) {
      for (const [settingKey, defaultValue] of Object.entries(
        DEFAULT_SYSTEM_SETTINGS,
      )) {
        const scopedKey = getScopedSettingKey(settingKey, adminUsername);
        const existingScoped = await SystemSettings.findOne({ key: scopedKey });
        if (!existingScoped) {
          await SystemSettings.create({ key: scopedKey, value: defaultValue });
        }
      }
    }
  } catch (error) {
    console.error("[SEED ERROR] System settings:", error.message);
  }
}
async function setupDefaultUsers() {
  const saltRounds = 10;
  const users = [
    {
      username: "student",
      password: getSeedPassword("SEED_STUDENT_PASSWORD"),
      firstName: "Juan",
      lastName: "Cruz",
      studentID: "2026-STUDENT-0001",
      email: process.env.SEED_STUDENT_EMAIL || "juancruz@dlsud.edu.ph",
      gradeLevel: "12",
      role: "student",
      status: "Approved",
    },
    {
      username: "faculty",
      password: getSeedPassword("SEED_FACULTY_PASSWORD"),
      firstName: "Maria",
      lastName: "Dela Cruz",
      studentID: "FACULTY-0001",
      email: process.env.SEED_FACULTY_EMAIL || "mariadelacruz@dlsud.edu.ph",
      gradeLevel: "N/A",
      role: "faculty",
      status: "Approved",
    },
  ];
  for (const userData of users) {
    try {
      const userExists = await User.findOne({ studentID: userData.studentID });
      if (!userExists) {
        const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
        const newUser = new User({ ...userData, password: hashedPassword });
        await newUser.save();
        console.log(`[SEED] User '${userData.username}' initialized.`);
      } else {
        console.log(`[SEED] User '${userData.username}' exists.`);
      }
    } catch (error) {
      console.error(`[SEED ERROR] User '${userData.username}':`, error.message);
    }
  }
}
const seedDatabase = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.warn("[SEED WARN] Database not connected. Skipping seeding.");
    return;
  }
  try {
    await setupDefaultAdmins();
    await setupDefaultUsers();
    await setupDefaultSettings();
    console.log("[SEED] Database seeding process completed.");
  } catch (error) {
    console.error("[SEED ERROR] Database seeding failed:", error.message);
  }
};
module.exports = {
  seedDatabase: seedDatabase,
  getScopedSettingKey: getScopedSettingKey,
};
