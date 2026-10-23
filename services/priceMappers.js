// Replace supplier (cost) prices with selling prices before anything reaches the app.
// Fields that would reveal the cost breakdown (base / tax / per-passenger cost) are removed.

function priceFlightOffer(offer, pricer) {
  if (!offer || typeof offer !== "object") return offer;
  const { base, tax, passengers, ...rest } = offer;
  return {
    ...rest,
    total: pricer.money(offer.total),
    passengers: Array.isArray(passengers)
      ? passengers.map(({ type, count }) => ({ type, count }))
      : undefined,
  };
}

function priceFlightSearch(search, pricer) {
  return {
    ...search,
    offers: Array.isArray(search?.offers) ? search.offers.map((o) => priceFlightOffer(o, pricer)) : [],
  };
}

function priceHotelSummary(summary, pricer) {
  return {
    ...summary,
    lead_rate: pricer.money(summary.lead_rate),
    lead_rate_before_discount: summary.lead_rate_before_discount
      ? pricer.money(summary.lead_rate_before_discount)
      : summary.lead_rate_before_discount,
  };
}

function priceHotelRate(rate, pricer) {
  return {
    ...rate,
    total: pricer.money(rate.total),
    total_before_discount: rate.total_before_discount
      ? pricer.money(rate.total_before_discount)
      : rate.total_before_discount,
  };
}

function priceHotelSearch(search, pricer) {
  const offers = Array.isArray(search?.offers) ? search.offers : [];
  return {
    ...search,
    offers: offers.map((offer) =>
      offer.object === "hotel_rate" ? priceHotelRate(offer, pricer) : priceHotelSummary(offer, pricer)
    ),
  };
}

function priceActivityProduct(product, pricer) {
  return product?.from ? { ...product, from: pricer.money(product.from, { perUnit: true }) } : product;
}

function priceActivityList(list, pricer) {
  return {
    ...list,
    data: Array.isArray(list?.data) ? list.data.map((p) => priceActivityProduct(p, pricer)) : [],
  };
}

function priceBookingOptionGroup(options, pricer) {
  if (!Array.isArray(options)) return options;
  return options.map((option) => ({
    ...option,
    price: option.price ? pricer.money(option.price, { perUnit: true }) : option.price,
    items: Array.isArray(option.items)
      ? option.items.map((item) => ({
          ...item,
          price: item.price ? pricer.money(item.price, { perUnit: true }) : item.price,
        }))
      : option.items,
  }));
}

function priceActivityAvailability(availability, pricer) {
  const result = { ...availability };
  if (Array.isArray(availability?.rates)) {
    result.rates = availability.rates.map((rate) => ({
      ...rate,
      price: pricer.money(rate.price, { perUnit: true }),
    }));
  }
  if (availability?.booking_options) {
    result.booking_options = {
      per_booking: priceBookingOptionGroup(availability.booking_options.per_booking, pricer),
      per_pax: priceBookingOptionGroup(availability.booking_options.per_pax, pricer),
    };
  }
  // Fixed fee charged once per booking on top of the per-traveller rates.
  result.service_fee = { amount: pricer.rule.fixedAmount.toFixed(2), currency: "USD" };
  return result;
}

module.exports = {
  priceFlightOffer,
  priceFlightSearch,
  priceHotelSearch,
  priceHotelRate,
  priceActivityList,
  priceActivityProduct,
  priceActivityAvailability,
};
