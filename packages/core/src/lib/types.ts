export type Promisable<T> = T | PromiseLike<T>;

export const Kind: unique symbol = Symbol.for("Veyor.Kind");
export const Meta: unique symbol = Symbol.for("Veyor.Meta");
