const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// One row per service. The selling price shown to customers is:
//   cost + cost * percent / 100 + fixedAmount   (fixedAmount is per booking, USD)
const PricingRule = sequelize.define(
  "PricingRule",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    service: {
      type: DataTypes.ENUM("flights", "hotels", "activities"),
      allowNull: false,
      unique: true,
    },
    percent: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      defaultValue: 0,
    },
    fixedAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    updatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "pricing_rules",
    timestamps: true,
  }
);

module.exports = PricingRule;
