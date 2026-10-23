const sequelize = require("../config/db");

// sync() creates missing tables but never adds columns to existing ones.
// This adds any column a model gained since the table was created (never drops or alters).
async function ensureSchema() {
  const queryInterface = sequelize.getQueryInterface();
  await sequelize.sync();

  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await queryInterface.describeTable(table);
    for (const [name, attribute] of Object.entries(model.getAttributes())) {
      const column = attribute.field || name;
      if (existing[column]) continue;
      await queryInterface.addColumn(table, column, {
        type: attribute.type,
        allowNull: attribute.allowNull !== false,
        defaultValue: attribute.defaultValue,
      });
      console.log(`[schema] added ${table}.${column}`);
    }
  }
}

module.exports = { ensureSchema };
