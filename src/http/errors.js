// Maps errors to HTTP responses. Every error body has the same shape:
// `{ error: { code, message, details? } }`.

import { ConflictError, DomainError, NotFoundError, ValidationError } from '../domain/errors.js';

/** An error raised by the HTTP layer itself (bad JSON, missing body ...). */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function statusFor(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error instanceof DomainError) return 422;
  return 500;
}

export function errorResponse(error) {
  const status = statusFor(error);
  if (status === 500) {
    return { status, body: { error: { code: 'internal_error', message: 'Internal error' } } };
  }
  const body = { error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  return { status, body };
}
