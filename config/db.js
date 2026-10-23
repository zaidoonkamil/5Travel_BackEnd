const { Sequelize } = require("sequelize");
const mysql2 = require("mysql2");
const dotenv = require("dotenv");
dotenv.config();

const sequelize = new Sequelize(
    process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST || "localhost",
    port: Number.parseInt(process.env.DB_PORT || "3306", 10),
    dialect: "mysql",
    dialectModule: mysql2,
    logging: false,
    pool: {
        max: Number.parseInt(process.env.DB_POOL_MAX || "20", 10),
        min: 0,
        acquire: 30000,
        idle: 10000,
    },
});

module.exports = sequelize;
