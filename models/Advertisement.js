const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Home screen ad slides (same idea as wasalni), each optionally opening something when tapped.
const Advertisement = sequelize.define(
  "Advertisement",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    description: { type: DataTypes.STRING(300), allowNull: true },
    // Stored as uploads/custom/xxx.jpg, returned as an absolute URL.
    image: { type: DataTypes.STRING, allowNull: false },
    // What a tap opens: nothing, a link, an admin hotel/activity, or a search screen.
    actionType: {
      type: DataTypes.ENUM("none", "url", "custom_hotel", "custom_activity", "flights", "hotels", "activities"),
      allowNull: false,
      defaultValue: "none",
    },
    // URL for "url", the item id for custom_hotel / custom_activity.
    actionValue: { type: DataTypes.STRING(500), allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    updatedByAdminId: { type: DataTypes.INTEGER, allowNull: true },
  },
  { timestamps: true, tableName: "advertisements" }
);

module.exports = Advertisement;
