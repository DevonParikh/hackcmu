/** Printed mappings for the owner's plain-language answers. Shared by the report and the impact math. */
export const BUCKETS = {
  share: { most: [0.6, 0.85], half: [0.4, 0.6], some: [0.15, 0.35], unsure: [0.15, 0.85] } as Record<string, [number, number]>,
  minutes: { under2: [1, 2], "2to5": [2, 5], "5to10": [5, 10], "10to20": [10, 20], over20: [20, 30], unsure: [1, 20] } as Record<string, [number, number]>,
  reply: { "1h": [0, 1], fewHours: [1, 4], sameDay: [1, 8], nextDay: [8, 24], "2to3days": [24, 72], longer: [72, 168], unsure: [1, 72] } as Record<string, [number, number]>,
};
export const BUCKET_LABELS = {
  share: { most: "most (about 3 in 4)", half: "about half", some: "some (about 1 in 4)", unsure: "not sure" } as Record<string, string>,
  minutes: { under2: "under 2 min", "2to5": "2-5 min", "5to10": "5-10 min", "10to20": "10-20 min", over20: "more than 20 min", unsure: "not sure" } as Record<string, string>,
  reply: { "1h": "within 1 hour", fewHours: "a few hours", sameDay: "same day", nextDay: "next business day", "2to3days": "2-3 days", longer: "longer", unsure: "not sure" } as Record<string, string>,
};
