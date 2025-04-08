export const Q192 = BigInt(2) ** BigInt(192)
export const Q192str = Q192.toString()
export const ten = BigInt(10)
export const zero = BigInt(0)
export const one = BigInt(1)
export const tenToThePowerOf = (n: number | string | bigint) => {
    if (typeof n === 'number') {
        return ten ** BigInt(n)
    } else if (typeof n === 'string') {
        return ten ** BigInt(Number(n))
    } else {
        return ten ** n
    }
}
