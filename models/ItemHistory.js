const mongoose = require("mongoose");

const itemHistorySchema = new mongoose.Schema({
  itemId: { type: String, required: true, index: true },
  action: { type: String, required: true }, // e.g., 'Created', 'Borrowed', 'Returned', 'Returned (Damaged)'
  studentName: { type: String },
  studentID: { type: String },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ItemHistory", itemHistorySchema);
