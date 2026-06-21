const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  studentID: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  gradeLevel: { type: String, required: true },
  password: { type: String, required: false },
  role: { type: String, default: "student" },
  status: { type: String, enum: ["Pending", "Approved"], default: "Pending" },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String },
  suspensionDate: { type: Date },
});

module.exports = mongoose.model("User", userSchema);
