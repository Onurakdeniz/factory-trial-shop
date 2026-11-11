// Domain errors carry a stable, machine-readable `code`. The HTTP layer maps the
// error class to a status and passes the code through to the client unchanged.

export class DomainError extends Error {
  constructor(message, { code = 'domain_error', details } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Input that can never be accepted (bad shape, out of range, unknown value). */
export class ValidationError extends DomainError {
  constructor(message, options = {}) {
    super(message, { code: 'validation_failed', ...options });
  }
}

/** A referenced record does not exist. */
export class NotFoundError extends DomainError {
  constructor(kind, id, options = {}) {
    super(`${kind} ${id} not found`, { code: 'not_found', details: { kind, id }, ...options });
  }
}

/** The request is valid but conflicts with the current state. */
export class ConflictError extends DomainError {
  constructor(message, options = {}) {
    super(message, { code: 'conflict', ...options });
  }
}

export class InsufficientStockError extends ConflictError {
  constructor(sku, requested, available) {
    super(`Not enough stock for ${sku}: requested ${requested}, available ${available}`, {
      code: 'insufficient_stock',
      details: { sku, requested, available },
    });
  }
}

export class InvalidTransitionError extends ConflictError {
  constructor(status, action) {
    super(`Cannot ${action} an order that is ${status}`, {
      code: 'invalid_transition',
      details: { status, action },
    });
  }
}
