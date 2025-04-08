import Decimal from "decimal.js";

export function safeDiv(a: bigint, b: bigint): bigint {
    if (b === BigInt(0)) {
        return BigInt(0)
    }
    return a / b;
}

export function inversePrice(price: Decimal): Decimal {
    if (price.eq(0)) {
        return new Decimal(0)
    }
    return Decimal('1').div(price)
}