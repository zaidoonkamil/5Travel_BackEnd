const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// A visa the team handles by hand (no supplier): the admin describes it and designs the
// application form in `fields`.
const VisaOffer = sequelize.define(
  "VisaOffer",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    country: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    // e.g. "فيزا سياحية"; a country can have several.
    title: {
      type: DataTypes.STRING(160),
      allowNull: true,
    },
    // Relative path under uploads/.
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Free text: "5-7 أيام عمل".
    processingTime: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    // Free text: "30 يوم، دخول واحد".
    validity: {
      type: DataTypes.STRING(160),
      allowNull: true,
    },
    // Fees in USD; null = "حسب الطلب".
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    // [{ key, label, type, required, hint, options }] — see services/visaForms.js.
    fields: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    indexes: [{ fields: ["isActive", "sortOrder"] }],
  }
);

module.exports = VisaOffer;
