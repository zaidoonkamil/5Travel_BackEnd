const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Booking = sequelize.define(
  "Booking",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // Short human reference shown to the customer, e.g. FT-7Q2F9K.
    reference: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    service: {
      type: DataTypes.ENUM("flight", "hotel", "activity", "custom_hotel", "custom_activity"),
      allowNull: false,
    },
    // pending    → held at the supplier / waiting for payment & admin action
    // processing → issuance requested at the supplier
    // confirmed  → ticket issued / hotel confirmed / activity issued
    status: {
      type: DataTypes.ENUM("pending", "processing", "confirmed", "cancelled", "refunded", "failed"),
      allowNull: false,
      defaultValue: "pending",
    },
    title: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },
    travelDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    // Supplier side
    providerRef: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    providerStatus: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    providerDeadline: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    idempotencyKey: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    customItemId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Money (USD). sellAmount = costAmount + markupAmount
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: "USD",
    },
    costAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    markupAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    sellAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    // Online payment (no cash): unpaid → paid → refunded (back to the wallet).
    paymentStatus: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "unpaid",
    },
    // What was taken from the wallet, in IQD.
    paidAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    contact: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    // Travellers, search params and the supplier snapshot.
    details: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    adminNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "bookings",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["service", "status"] },
      { fields: ["providerRef"] },
    ],
  }
);

module.exports = Booking;
