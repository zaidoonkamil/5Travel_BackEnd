// Error carrying an HTTP status; the global error handler turns it into JSON.
class HttpError extends Error {
  constructor(statusCode, message, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

function badRequest(message, extra) {
  return new HttpError(400, message, extra);
}

function notFound(message = "غير موجود") {
  return new HttpError(404, message);
}

module.exports = { HttpError, badRequest, notFound };
