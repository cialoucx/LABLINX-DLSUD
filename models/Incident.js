const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  damagedItemInfo: {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemId: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    modelName: { type: String, required: true },
  },
  responsibleUser: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    studentID: { type: String, required: true },
    studentName: { type: String, required: true },
  },
  originalTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ItemRequest",
    required: true,
  },
  status: {
    type: String,
    enum: ["Pending Replacement", "Resolved"],
    default: "Pending Replacement",
  },
  damageNotes: { type: String },
  dateReported: { type: Date, default: Date.now },
  dateResolved: { type: Date },
  resolutionNotes: { type: String },
  replacementItemId: { type: String },
  studentReportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "StudentIncidentReport",
  },
  deadlineAt: { type: Date },
  notificationSent: { type: Boolean, default: false },
});

module.exports = mongoose.model("Incident", incidentSchema);
