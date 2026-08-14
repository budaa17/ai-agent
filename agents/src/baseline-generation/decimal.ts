import type { z } from "zod";
import { phase7MeasurementUnitSchema, type QuantityFormulaDefinitionV1 } from "./contracts.js";

export type ExactDecimal = Readonly<{
  coefficient: bigint;
  scale: number;
}>;

const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/u;

function powerOfTen(power: number): bigint {
  if (!Number.isInteger(power) || power < 0) {
    throw new Error("Decimal power must be a nonnegative integer");
  }
  return 10n ** BigInt(power);
}

export function parseExactDecimal(value: string): ExactDecimal {
  const match = decimalPattern.exec(value);
  if (match === null) {
    throw new Error(`Invalid plain decimal: ${value}`);
  }
  const fraction = match[3] ?? "";
  const coefficient = BigInt(`${match[2] ?? "0"}${fraction}`);
  return normalizeExactDecimal({
    coefficient: match[1] === "-" ? -coefficient : coefficient,
    scale: fraction.length,
  });
}

export function normalizeExactDecimal(value: ExactDecimal): ExactDecimal {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function alignDecimals(left: ExactDecimal, right: ExactDecimal): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
    scale,
  ];
}

export function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [leftValue, rightValue, scale] = alignDecimals(left, right);
  return normalizeExactDecimal({ coefficient: leftValue + rightValue, scale });
}

export function subtractExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [leftValue, rightValue, scale] = alignDecimals(left, right);
  return normalizeExactDecimal({ coefficient: leftValue - rightValue, scale });
}

export function multiplyExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return normalizeExactDecimal({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const [leftValue, rightValue] = alignDecimals(left, right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function roundExactDecimal(value: ExactDecimal, decimalPlaces: number): ExactDecimal {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new Error("Decimal places must be a nonnegative integer");
  }
  if (value.scale <= decimalPlaces) {
    return {
      coefficient: value.coefficient * powerOfTen(decimalPlaces - value.scale),
      scale: decimalPlaces,
    };
  }
  const divisor = powerOfTen(value.scale - decimalPlaces);
  const quotient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const rounded =
    absoluteRemainder * 2n < divisor ? quotient : quotient + (value.coefficient < 0n ? -1n : 1n);
  return { coefficient: rounded, scale: decimalPlaces };
}

export function formatExactDecimal(
  value: ExactDecimal,
  options: Readonly<{ fixedScale?: number; trimTrailingZeros?: boolean }> = {},
): string {
  const fixedScale = options.fixedScale;
  const normalized = fixedScale === undefined ? value : roundExactDecimal(value, fixedScale);
  const negative = normalized.coefficient < 0n;
  const absolute = negative ? -normalized.coefficient : normalized.coefficient;
  const digits = absolute.toString().padStart(normalized.scale + 1, "0");
  const splitAt = digits.length - normalized.scale;
  const whole = digits.slice(0, splitAt);
  const fraction = normalized.scale === 0 ? "" : digits.slice(splitAt);
  let result = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  if (options.trimTrailingZeros !== false && result.includes(".")) {
    result = result.replace(/0+$/u, "").replace(/\.$/u, "");
  }
  if (result === "0") {
    return result;
  }
  return negative ? `-${result}` : result;
}

export function ceilExactDivision(numerator: ExactDecimal, denominator: ExactDecimal): number {
  if (numerator.coefficient < 0n || denominator.coefficient <= 0n) {
    throw new Error("Ceiling division requires nonnegative/positive operands");
  }
  const scaledNumerator = numerator.coefficient * powerOfTen(denominator.scale);
  const scaledDenominator = denominator.coefficient * powerOfTen(numerator.scale);
  const result = (scaledNumerator + scaledDenominator - 1n) / scaledDenominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Ceiling division exceeds the safe integer range");
  }
  return Number(result);
}

type MeasurementUnit = z.infer<typeof phase7MeasurementUnitSchema>;

const unitMetadata: Readonly<
  Record<MeasurementUnit, Readonly<{ family: string; base10Exponent: number }>>
> = {
  mm: { family: "length", base10Exponent: -3 },
  cm: { family: "length", base10Exponent: -2 },
  m: { family: "length", base10Exponent: 0 },
  mm2: { family: "area", base10Exponent: -6 },
  cm2: { family: "area", base10Exponent: -4 },
  m2: { family: "area", base10Exponent: 0 },
  mm3: { family: "volume", base10Exponent: -9 },
  cm3: { family: "volume", base10Exponent: -6 },
  m3: { family: "volume", base10Exponent: 0 },
  pcs: { family: "count", base10Exponent: 0 },
};

export function convertMeasurement(
  value: string,
  fromUnit: MeasurementUnit,
  toUnit: MeasurementUnit,
  decimalPlaces = 6,
): string {
  phase7MeasurementUnitSchema.parse(fromUnit);
  phase7MeasurementUnitSchema.parse(toUnit);
  const from = unitMetadata[fromUnit];
  const to = unitMetadata[toUnit];
  if (from.family !== to.family) {
    throw new Error(`Cannot convert ${fromUnit} to ${toUnit}`);
  }
  const input = parseExactDecimal(value);
  const exponent = from.base10Exponent - to.base10Exponent;
  const converted =
    exponent >= 0
      ? {
          coefficient: input.coefficient * powerOfTen(exponent),
          scale: input.scale,
        }
      : {
          coefficient: input.coefficient,
          scale: input.scale - exponent,
        };
  return formatExactDecimal(roundExactDecimal(converted, decimalPlaces));
}

export function applyRatio(value: ExactDecimal, ratio: string): ExactDecimal {
  return multiplyExactDecimals(
    value,
    addExactDecimals(parseExactDecimal("1"), parseExactDecimal(ratio)),
  );
}

export function calculateMoney(quantity: string, unitPriceMnt: string): string {
  return formatExactDecimal(
    roundExactDecimal(
      multiplyExactDecimals(parseExactDecimal(quantity), parseExactDecimal(unitPriceMnt)),
      2,
    ),
    { fixedScale: 2, trimTrailingZeros: false },
  );
}

export function calculateRateAmount(amountMnt: string, rate: string): string {
  return formatExactDecimal(
    roundExactDecimal(
      multiplyExactDecimals(parseExactDecimal(amountMnt), parseExactDecimal(rate)),
      2,
    ),
    { fixedScale: 2, trimTrailingZeros: false },
  );
}

export function sumMoney(values: readonly string[]): string {
  const total = values.reduce(
    (sum, value) => addExactDecimals(sum, parseExactDecimal(value)),
    parseExactDecimal("0"),
  );
  return formatExactDecimal(roundExactDecimal(total, 2), {
    fixedScale: 2,
    trimTrailingZeros: false,
  });
}

export function formulaOutput(
  value: ExactDecimal,
  formula: QuantityFormulaDefinitionV1,
): Readonly<{ unrounded: string; rounded: string }> {
  return {
    unrounded: formatExactDecimal(value),
    rounded: formatExactDecimal(roundExactDecimal(value, formula.decimalPlaces)),
  };
}
