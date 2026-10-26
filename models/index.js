const User = require("./user");
const PricingRule = require("./PricingRule");
const CustomHotel = require("./CustomHotel");
const CustomActivity = require("./CustomActivity");
const Booking = require("./Booking");
const OtpCode = require("./OtpCode");
const UserDevice = require("./UserDevice");
const NotificationLog = require("./NotificationLog");
const Advertisement = require("./Advertisement");
const SupportMessage = require("./SupportMessage");
const VisaOffer = require("./VisaOffer");
const VisaApplication = require("./VisaApplication");
const CurrencyOverride = require("./CurrencyOverride");

User.hasMany(Booking, { foreignKey: "userId", as: "bookings", onDelete: "CASCADE" });
Booking.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });

User.hasMany(UserDevice, { foreignKey: "user_id", as: "devices", onDelete: "CASCADE" });
UserDevice.belongsTo(User, { foreignKey: "user_id", as: "user", onDelete: "CASCADE" });

User.hasMany(SupportMessage, { foreignKey: "userId", as: "supportMessages", onDelete: "CASCADE" });
SupportMessage.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
SupportMessage.belongsTo(User, { foreignKey: "adminId", as: "admin", constraints: false });

User.hasMany(VisaApplication, { foreignKey: "userId", as: "visaApplications", onDelete: "CASCADE" });
VisaApplication.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
// Applications keep their own copy of the visa, so deleting an offer leaves them intact.
VisaApplication.belongsTo(VisaOffer, { foreignKey: "visaId", as: "offer", constraints: false });

module.exports = {
  User,
  PricingRule,
  CustomHotel,
  CustomActivity,
  Booking,
  OtpCode,
  UserDevice,
  NotificationLog,
  Advertisement,
  SupportMessage,
  VisaOffer,
  VisaApplication,
  CurrencyOverride,
};
