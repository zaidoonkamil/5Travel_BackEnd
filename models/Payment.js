const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// An online card payment through SwiftPayIQ: one payment link per attempt.
// Whatever is paid lands in the user's wallet; a booking payment is then taken from there.
const Payment = sequelize.define(
  "Payment",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    // topup = wallet credit only; booking = credit, then pay that booking from the wallet.
    purpose: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    bookingId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // IQD, whole dinars.
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    // pending → paid | failed
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "pending",
    },
    provider: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "swiftpay",
    },
    linkId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    payPageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    // SwiftPay paymentId / gateway transaction, once paid.
    providerPaymentId: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "payments",
    timestamps: true,
    indexes: [{ fields: ["userId"] }, { fields: ["linkId"] }],
  }
);

module.exports = Payment;
