const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Chat between a customer and the support team: one conversation per user, any admin answers.
const SupportMessage = sequelize.define(
  "SupportMessage",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // The customer the conversation belongs to (also for the admins' replies).
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sender: {
      type: DataTypes.ENUM("user", "admin"),
      allowNull: false,
    },
    // The admin who wrote it, for the panel.
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("text", "image"),
      allowNull: false,
      defaultValue: "text",
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Relative path under uploads/.
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Seen by the other side ("read" is a reserved word in MySQL).
    seen: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    indexes: [{ fields: ["userId", "id"] }],
  }
);

module.exports = SupportMessage;
