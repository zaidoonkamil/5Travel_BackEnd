const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// A rate the admin fixes by hand (e.g. the Iraqi dinar at the market rate), used instead of
// the daily rate from the provider. 1 USD = `rate` units of `code`.
const CurrencyOverride = sequelize.define("CurrencyOverride", {
  code: {
    type: DataTypes.STRING(3),
    primaryKey: true,
  },
  rate: {
    type: DataTypes.DECIMAL(18, 6),
    allowNull: false,
  },
});

module.exports = CurrencyOverride;
