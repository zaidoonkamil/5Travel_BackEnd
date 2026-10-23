const User = require("./user");
const PricingRule = require("./PricingRule");
const CustomHotel = require("./CustomHotel");
const CustomActivity = require("./CustomActivity");
const Booking = require("./Booking");
const OtpCode = require("./OtpCode");

User.hasMany(Booking, { foreignKey: "userId", as: "bookings", onDelete: "CASCADE" });
Booking.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });

module.exports = {
  User,
  PricingRule,
  CustomHotel,
  CustomActivity,
  Booking,
  OtpCode,
};
