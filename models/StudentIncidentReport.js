const mongoose = require("mongoose");

const studentIncidentReportSchema = new mongoose.Schema({
  incidentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Incident",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  equipmentId: { type: String, required: true },
  dateOfIncident: { type: Date, required: true },
  incidentType: {
    type: String,
    enum: [
      "Damage to Equipment/Facility",
      "Lost or Missing Item",
      "Security Breach or Facility Compromise",
      "Personal Injury (Contact Supervisor Immediately)",
      "Other",
    ],
    required: true,
  },
  detailedDescription: {
    type: String,
    default: "Pending student submission",
    validate: {
      validator: function (v) {
        if (this.status === "Pending Submission" || !this.status) {
          return true;
        }
        return v && v.trim() !== "";
      },
      message:
        "detailedDescription is required when status is not Pending Submission",
    },
  },
  otherDescription: { type: String },
  submittedAt: { type: Date },
  deadlineAt: { type: Date, required: true },
  status: {
    type: String,
    enum: [
      "Pending Submission",
      "Submitted",
      "Pending Review",
      "Resolved",
      "Rejected",
      "Overdue",
    ],
    default: "Pending Submission",
  },
  admin2ReviewNotes: { type: String },
  resolvedAt: { type: Date },
  replacementItemId: { type: String },
  replacedItems: { type: String },
  damageDescription: { type: String },
  replacementAction: { type: String },
  returnDuration: { type: Number },
  itemConditionOnReturn: {
    type: String,
    enum: ["Good", "Damaged", "Lost", "Replaced", ""],
    default: "",
  },
  replacementStatus: {
    type: String,
    enum: ["Not Required", "Pending", "In Progress", "Completed", ""],
    default: "",
  },
  replacementDate: { type: Date },
});

// Pre-validate hook
studentIncidentReportSchema.pre("validate", function (next) {
  if (this.status === "Pending Submission" || !this.status) {
    if (
      !this.detailedDescription ||
      this.detailedDescription.trim() === "" ||
      this.detailedDescription === undefined
    ) {
      this.detailedDescription = "Pending student submission";
    }
  }
  next();
});

// Pre-save validation
studentIncidentReportSchema.pre("save", function (next) {
  if (
    this.status !== "Pending Submission" &&
    (!this.detailedDescription || this.detailedDescription.trim() === "")
  ) {
    return next(
      new Error(
        "detailedDescription is required when status is not Pending Submission",
      ),
    );
  }
  next();
});

module.exports = mongoose.model(
  "StudentIncidentReport",
  studentIncidentReportSchema,
);
