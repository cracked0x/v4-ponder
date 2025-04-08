import Decimal from "decimal.js"
import { Q192str, tenToThePowerOf, one } from "./constants"
import { inversePrice } from "./index"

export function sqrtPriceX96ToTokenPrices(
    sqrtPriceX96: bigint,
    token0Decimals: number,
    token1Decimals: number,
): [Decimal, Decimal] {

    const num = new Decimal((sqrtPriceX96 * sqrtPriceX96).toString())
    const denom = new Decimal(Q192str)
    const token0Exponent = new Decimal(tenToThePowerOf(token0Decimals).toString())
    const token1Exponent = new Decimal(tenToThePowerOf(token1Decimals).toString())
    const price1 = (num.div(denom).mul(token0Exponent).div(token1Exponent)).toDP(token1Decimals)

    const price0 = inversePrice(price1).toDP(token0Decimals)
    return [price0, price1]
}