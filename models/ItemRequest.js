const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  studentName: { type: String, required: true },
  studentID: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  startDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  reason: { type: String, required: true },
  requestDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected", "Returned"],
    default: "Pending",
  },
  category: { type: String, required: true },
  isDeleted: { type: Boolean, default: false },
  returnCondition: {
    type: String,
    enum: ["Good", "Damaged", "Lost"],
    default: "Good",
  },
  damageNotes: { type: String },
});

module.exports = mongoose.model("ItemRequest", requestSchema);
