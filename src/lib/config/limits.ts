import { MAX_BOARD_RETENTION_DAYS } from "../constants/access.ts";

type IntegerSetting = {
  name: string;
  defaultValue: number;
  min: number;
  max: number;
};

export const parseIntegerSetting = (
  rawValue: string | undefined,
  { name, defaultValue, min, max }: IntegerSetting,
): number => {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!/^-?\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
};

export const getBoardRetentionDays = (env: NodeJS.ProcessEnv = process.env): number =>
  parseIntegerSetting(env.BOARD_RETENTION_DAYS, {
    name: "BOARD_RETENTION_DAYS",
    defaultValue: 90,
    min: 1,
    max: MAX_BOARD_RETENTION_DAYS,
  });

export const getBoardCardLimit = (env: NodeJS.ProcessEnv = process.env): number =>
  parseIntegerSetting(env.BOARD_CARD_LIMIT, {
    name: "BOARD_CARD_LIMIT",
    defaultValue: 500,
    min: 1,
    max: 10000,
  });
