import { z } from "zod";

export const projectCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().normalize("NFC") : value),
  z
    .string()
    .min(2)
    .max(100)
    .regex(/^[\p{L}0-9][\p{L}0-9._-]*$/u, "Код монгол/англи үсэг, тоо, . _ - тэмдэгттэй байна"),
);
