const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// Hotels the admin adds by hand, shown next to the supplier hotels.
// The admin sets the final selling price directly (no markup applied).
const CustomHotel = sequelize.define(
  "CustomHotel",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
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
    // Optional supplier city id so the hotel also appears in that city search.
    hermesCityId: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    stars: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    pricePerNight: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    mealPlan: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    facilities: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
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
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "custom_hotels",
    timestamps: true,
  }
);

module.exports = CustomHotel;
