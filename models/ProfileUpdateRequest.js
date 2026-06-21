const mongoose = require("mongoose");

const profileUpdateRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, required: true },
  currentFullName: { type: String, required: true },
  newFirstName: { type: String, required: true },
  newLastName: { type: String, required: true },
  newEmail: { type: String, required: true },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },
  requestedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model(
  "ProfileUpdateRequest",
  profileUpdateRequestSchema,
  "profile_update_requests",
);
