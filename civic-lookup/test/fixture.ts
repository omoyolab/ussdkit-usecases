// A made-up state for the tests. Every name and party here is invented, so the tests never state
// anything about real people. It has what the menu must cope with: a split LGA, a vacant seat,
// a long candidate list, and a long name.
import type { Snapshot } from "../src/civic.js";

export const fixture: Snapshot = {
  savedAt: "2026-10-04",
  credit: "test data",
  states: {
    Lagos: {
      lgas: ["Amber", "Brook", "Cedar Island", "Delta Hill", "Ember", "Fern", "Grove", "Harbour"],
      seats: [
        { code: "SD/001/LA", name: "Sample East", chamber: "senate", lgas: ["Amber", "Brook", "Cedar Island", "Delta Hill"], candidateCount: 9, sittingMember: { name: "Ada Okafor", party: "AAA" } },
        { code: "SD/002/LA", name: "Sample West", chamber: "senate", lgas: ["Ember", "Fern", "Grove", "Harbour"], candidateCount: 2, sittingMember: null },
        { code: "FC/001/LA", name: "Amber/Brook", chamber: "house", lgas: ["Amber", "Brook"], candidateCount: 3, sittingMember: { name: "Bello Musa", party: "BBB" } },
        { code: "FC/002/LA", name: "Cedar Island I", chamber: "house", lgas: ["Cedar Island"], candidateCount: 1, sittingMember: { name: "Chika Obi", party: "AAA" } },
        { code: "FC/003/LA", name: "Cedar Island II", chamber: "house", lgas: ["Cedar-Island"], candidateCount: 1, sittingMember: { name: "Dayo Ade", party: "CCC" } },
        { code: "FC/004/LA", name: "Delta Hill", chamber: "house", lgas: ["Delta Hill"], candidateCount: 1, sittingMember: { name: "Oluwaseyifunmi Adebayo-Williamson Ogunleye", party: "BBB" } },
        { code: "FC/005/LA", name: "Ember/Fern/Grove/Harbour", chamber: "house", lgas: ["Ember", "Fern", "Grove", "Harbour"], candidateCount: 1, sittingMember: { name: "Efe Udo", party: "AAA" } },
      ],
    },
  },
  candidates: {
    "SD/001/LA": [
      { name: "Ada Okafor", party: "AAA", isIncumbent: true },
      { name: "Zainab Bello", party: "ZZZ", isIncumbent: false },
      { name: "Musa Ibrahim", party: "MMM", isIncumbent: false },
      { name: "Kemi Adeyemi", party: "KKK", isIncumbent: false },
      { name: "Tunde Bakare", party: "TTT", isIncumbent: false },
      { name: "Ngozi Eze", party: "NNN", isIncumbent: false },
      { name: "Emeka Nwosu", party: "EEE", isIncumbent: false },
      { name: "Halima Sani", party: "HHH", isIncumbent: false },
      { name: "Bayo Ojo", party: "BBB", isIncumbent: false },
    ],
    "FC/001/LA": [
      { name: "Bello Musa", party: "BBB", isIncumbent: true },
      { name: "Ife Ola", party: "AAA", isIncumbent: false },
      { name: "Uche Okeke", party: "CCC", isIncumbent: false },
    ],
  },
  presidential: [
    { party: "ZZZ", candidate: "Zara Example", runningMate: "Yemi Example" },
    { party: "AAA", candidate: "Abu Example", runningMate: "Bisi Example" },
    { party: "MMM", candidate: null, runningMate: null },
  ],
};
