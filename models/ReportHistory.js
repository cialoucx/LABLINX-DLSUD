const mongoose = require("mongoose");

const reportHistorySchema = new mongoose.Schema({
  reportType: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
  generatedBy: { type: String, required: true },
});

module.exports = mongoose.model("ReportHistory", reportHistorySchema);
