const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// A customer's visa request. The visa and its form are copied in when it is submitted, so
// later edits of the offer never change what the customer answered.
const VisaApplication = sequelize.define(
  "VisaApplication",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    reference: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    visaId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // { country, title, image, price, processingTime, validity }
    visa: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    fields: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    // { [fieldKey]: string }
    answers: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    // { [fieldKey]: [{ file, name, mime, size }] } — files live in private_uploads/visa.
    files: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    status: {
      type: DataTypes.ENUM("submitted", "reviewing", "needs_info", "processing", "approved", "rejected", "cancelled"),
      allowNull: false,
      defaultValue: "submitted",
    },
    // Latest message from the team, shown to the customer.
    userNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Internal, admins only.
    adminNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // The issued visa / letters the team hands back: [{ file, name, mime, size }].
    resultFiles: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    // [{ status, note, by: "user" | "admin", at }]
    timeline: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    indexes: [{ fields: ["userId"] }, { fields: ["status"] }],
  }
);

module.exports = VisaApplication;
