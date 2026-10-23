const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// One-time codes sent on WhatsApp: account verification and password reset.
const OtpCode = sequelize.define(
  "OtpCode",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    purpose: {
      type: DataTypes.ENUM("verify_account", "password_reset"),
      allowNull: false,
    },
    codeHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    attemptsLeft: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    consumedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "otp_codes",
    timestamps: true,
    indexes: [{ fields: ["phone", "purpose"] }, { fields: ["expiresAt"] }],
  }
);

module.exports = OtpCode;
