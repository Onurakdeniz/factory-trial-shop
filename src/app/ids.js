// Readable, sequential ids per prefix: cart_0001, ord_0001, res_0001 ...

export function createIdGenerator() {
  const counters = new Map();
  return {
    next(prefix) {
      const value = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, value);
      return `${prefix}_${String(value).padStart(4, '0')}`;
    },
  };
}
