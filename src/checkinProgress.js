// Day 300 是旅程起点；其后到 Day 365 共 65 天。仅用于展示，不改写签到记录。
export const JOURNEY_START_DAY = 300
export const JOURNEY_END_DAY = 365
export const JOURNEY_TOTAL_DAYS = JOURNEY_END_DAY - JOURNEY_START_DAY

export function countJourneySignedDays(days = []) {
  return new Set(days.map(Number).filter(day =>
    Number.isInteger(day) && day > JOURNEY_START_DAY && day <= JOURNEY_END_DAY
  )).size
}
