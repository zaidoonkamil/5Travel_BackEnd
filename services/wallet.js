const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, WalletTransaction } = require("../models");
const { HttpError } = require("./httpError");

function wholeDinars(amount) {
  const value = Math.round(Number(amount));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid wallet amount: ${amount}`);
  return value;
}

async function record(userId, amount, meta, transaction) {
  const user = await User.findByPk(userId, { attributes: ["id", "walletBalance"], transaction });
  return WalletTransaction.create(
    {
      userId,
      amount,
      balanceAfter: user.walletBalance,
      type: meta.type,
      bookingId: meta.bookingId ?? null,
      paymentId: meta.paymentId ?? null,
      adminId: meta.adminId ?? null,
      note: meta.note ? String(meta.note).slice(0, 300) : null,
    },
    { transaction }
  );
}

// Adds money: top-ups, refunds, admin credits.
async function credit(userId, amount, meta) {
  const value = wholeDinars(amount);
  return sequelize.transaction(async (transaction) => {
    await User.increment({ walletBalance: value }, { where: { id: userId }, transaction });
    return record(userId, value, meta, transaction);
  });
}

// Takes money only if the balance covers it, in a single conditional UPDATE so two
// payments at the same moment can never overdraw the wallet.
async function debit(userId, amount, meta) {
  const value = wholeDinars(amount);
  return sequelize.transaction(async (transaction) => {
    const [affected] = await User.update(
      { walletBalance: sequelize.literal(`walletBalance - ${value}`) },
      { where: { id: userId, walletBalance: { [Op.gte]: value } }, transaction }
    );
    if (!affected) throw new HttpError(409, "رصيد المحفظة غير كافٍ", { code: "insufficient_balance" });
    return record(userId, -value, meta, transaction);
  });
}

function serializeTransaction(t) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    bookingId: t.bookingId,
    note: t.note,
    createdAt: t.createdAt,
  };
}

module.exports = { credit, debit, serializeTransaction };
