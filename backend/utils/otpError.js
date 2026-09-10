class OtpError extends Error {
  constructor(status, reason, message, details = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.details = details;
  }
}
module.exports = { OtpError };
