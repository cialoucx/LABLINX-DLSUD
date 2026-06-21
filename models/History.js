const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  adminUsername: { type: String, required: true },
  action: { type: String, required: true },
  details: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("History", historySchema);
