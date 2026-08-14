const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const moneyPattern = /^(-?)(0|[1-9]\d*)\.(\d{2})$/;

export const DECIMAL_SCALE = 1_000_000n;

export function decimalToScaledInteger(value: string): bigint {
  const match = decimalPattern.exec(value);

  if (match === null) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]!);
  const fraction = BigInt((match[3] ?? "").padEnd(6, "0"));

  return sign * (whole * DECIMAL_SCALE + fraction);
}

export function moneyToCents(value: string): bigint {
  const match = moneyPattern.exec(value);

  if (match === null) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;

  return sign * (BigInt(match[2]!) * 100n + BigInt(match[3]!));
}

export function centsToMoney(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  return `${sign}${whole}.${cents}`;
}

export function quantityTimesUnitCostCents(quantity: string, unitCost: string): bigint {
  const product = decimalToScaledInteger(quantity) * moneyToCents(unitCost);
  const quotient = product / DECIMAL_SCALE;
  const remainder = product % DECIMAL_SCALE;

  if (remainder === 0n) {
    return quotient;
  }

  const absoluteRemainder = remainder < 0n ? -remainder : remainder;

  if (absoluteRemainder * 2n < DECIMAL_SCALE) {
    return quotient;
  }

  return quotient + (product < 0n ? -1n : 1n);
}

export function bigintRatioPercent(numerator: bigint, denominator: bigint, precision = 2): number {
  if (denominator === 0n) {
    throw new Error("Cannot calculate a ratio with a zero denominator");
  }

  const factor = 10n ** BigInt(precision);
  const scaled = (numerator * 100n * factor) / denominator;
  return Number(scaled) / Number(factor);
}
