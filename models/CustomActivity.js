const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Tours / activities the admin adds by hand, shown next to the supplier catalogue.
// The admin sets the final selling price directly (no markup applied).
const CustomActivity = sequelize.define(
  "CustomActivity",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    country: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    duration: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    includes: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    priceAdult: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    priceChild: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    images: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // Partner account (hotel / farm owner, tour operator…) that manages this listing's bookings.
    ownerId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "custom_activities",
    timestamps: true,
  }
);

module.exports = CustomActivity;
