const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    fullName: {
        type: DataTypes.STRING(120),
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING(190),
        allowNull: true,
        unique: true,
    },
    phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.ENUM("user", "admin"),
        allowNull: false,
        defaultValue: "user",
    },
    // pending = registered but phone not verified with the WhatsApp code yet.
    status: {
        type: DataTypes.ENUM("pending", "active"),
        allowNull: false,
        defaultValue: "active",
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
    // Bumped on password change / role change to invalidate old JWTs.
    tokenVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: "users",
    timestamps: true,
    defaultScope: {
        attributes: { exclude: ["password"] },
    },
    scopes: {
        withPassword: { attributes: { include: ["password"] } },
    },
});

module.exports = User;
