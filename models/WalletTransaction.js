const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Every change to a wallet balance, newest last. Amounts in IQD: credits positive, debits negative.
const WalletTransaction = sequelize.define(
  "WalletTransaction",
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
    // topup | booking | refund | adjustment
    type: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    balanceAfter: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    bookingId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    paymentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Admin adjustments: who and why.
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    note: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
  },
  {
    tableName: "wallet_transactions",
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ["userId"] }],
  }
);

module.exports = WalletTransaction;
