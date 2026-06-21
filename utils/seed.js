const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const {
  DEFAULT_SYSTEM_SETTINGS,
  adminCategoryMapping,
} = require("../config/constants");

function getScopedSettingKey(settingKey, adminUsername) {
  return settingKey;
}

async function setupDefaultAdmins() {
  const saltRounds = 10;
  const admins = [
    {
      username: "admin",
      password: "admin123",
      firstName: "General",
      lastName: "Admin",
      studentID: "0000-ADMIN",
      email: "admin@dlsud.edu.ph",
    },
    {
      username: "admin2",
      password: "admin456",
      firstName: "Science",
      lastName: "Admin",
      studentID: "0001-ADMIN",
      email: "admin2@dlsud.edu.ph",
    },
    {
      username: "admin3",
      password: "admin789",
      firstName: "Facility",
      lastName: "Admin",
      studentID: "0002-ADMIN",
      email: "admin3@dlsud.edu.ph",
    },
    {
      username: "admin4",
      password: "admin999",
      firstName: "Robotics",
      lastName: "Admin",
      studentID: "0003-ADMIN",
      email: "admin4@dlsud.edu.ph",
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
        console.log(
          `👑 Default ${adminData.username} Created! Pass: ${adminData.password}`,
        );
      } else {
        console.log(
          `✅ Admin ${adminData.username} already exists. Skipping creation.`,
        );
      }
    } catch (error) {
      console.error(`❌ Error creating ${adminData.username}:`, error);
    }
  }
}

async function setupDefaultSettings() {
  const baseDefaults = Object.entries(DEFAULT_SYSTEM_SETTINGS).map(
    ([key, value]) => ({ key, value }),
  );

  for (const setting of baseDefaults) {
    const existing = await SystemSettings.findOne({ key: setting.key });
    if (!existing) {
      await SystemSettings.create(setting);
      console.log(
        `Default setting '${setting.key}' created with value: ${setting.value}`,
      );
    }
  }

  // Initialize scoped settings so each admin can manage independent values.
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
}

async function setupDefaultUsers() {
  const saltRounds = 10;
  const users = [
    {
      username: "student",
      password: "student123",
      firstName: "Juan",
      lastName: "Cruz",
      studentID: "2026-STUDENT-0001",
      email: "juancruz@dlsud.edu.ph",
      gradeLevel: "12",
      role: "student",
      status: "Approved",
    },
    {
      username: "faculty",
      password: "faculty123",
      firstName: "Maria",
      lastName: "Dela Cruz",
      studentID: "FACULTY-0001",
      email: "mariadelacruz@dlsud.edu.ph",
      gradeLevel: "N/A",
      role: "faculty",
      status: "Approved",
    },
  ];

  for (const userData of users) {
    try {
      const userExists = await User.findOne({
        studentID: userData.studentID,
      });
      if (!userExists) {
        const hashedPassword = await bcrypt.hash(
          userData.password,
          saltRounds,
        );
        const newUser = new User({
          ...userData,
          password: hashedPassword,
        });
        await newUser.save();
        console.log(
          `👤 Default ${userData.role} Created! User: ${userData.username}, Pass: ${userData.password}`,
        );
      } else {
        console.log(
          `✅ User ${userData.username} already exists. Skipping creation.`,
        );
      }
    } catch (error) {
      console.error(`❌ Error creating user ${userData.username}:`, error);
    }
  }
}

const seedDatabase = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ Database is not connected. Skipping database seeding.");
    return;
  }
  try {
    await setupDefaultAdmins();
    await setupDefaultUsers();
    await setupDefaultSettings();
    console.log("✅ Database seeding process completed.");
  } catch (error) {
    console.error("❌ Database seeding failed:", error);
  }
};

module.exports = { seedDatabase, getScopedSettingKey };
