const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Every push sent: shown to the user as their notifications list and to the admin as a log.
const NotificationLog = sequelize.define("NotificationLog", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  target_type: {
    type: DataTypes.ENUM("all", "user"),
    allowNull: false,
  },
  target_value: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  data: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "sent",
  },
}, {
  tableName: "notification_logs",
  timestamps: true,
});

module.exports = NotificationLog;
