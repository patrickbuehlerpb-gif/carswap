import type { User } from "../types";

export const CURRENT_USER_ID = "u-me";

export const users: User[] = [
  {
    id: "u-me",
    name: "Patrick B.",
    location: "Zürich",
    canton: "ZH",
    memberSince: "2025-11-04",
    rating: 4.9,
    swapsCompleted: 1,
    verified: true,
    avatarColor: "#7dd3fc",
  },
  {
    id: "u-002",
    name: "Michèle L.",
    location: "Winterthur",
    canton: "ZH",
    memberSince: "2025-06-18",
    rating: 4.8,
    swapsCompleted: 3,
    verified: true,
    avatarColor: "#fca5a5",
  },
  {
    id: "u-003",
    name: "Daniel K.",
    location: "Zug",
    canton: "ZG",
    memberSince: "2026-01-22",
    rating: 4.6,
    swapsCompleted: 1,
    verified: true,
    avatarColor: "#fcd34d",
  },
  {
    id: "u-004",
    name: "Sandra R.",
    location: "Bern",
    canton: "BE",
    memberSince: "2025-03-09",
    rating: 5.0,
    swapsCompleted: 5,
    verified: true,
    avatarColor: "#86efac",
  },
  {
    id: "u-005",
    name: "Tobias M.",
    location: "Luzern",
    canton: "LU",
    memberSince: "2026-04-30",
    rating: 4.4,
    swapsCompleted: 0,
    verified: false,
    avatarColor: "#c4b5fd",
  },
  {
    id: "u-006",
    name: "Anna S.",
    location: "St. Gallen",
    canton: "SG",
    memberSince: "2025-09-12",
    rating: 4.7,
    swapsCompleted: 2,
    verified: true,
    avatarColor: "#f9a8d4",
  },
  {
    id: "u-007",
    name: "Marco B.",
    location: "Basel",
    canton: "BS",
    memberSince: "2025-12-01",
    rating: 4.9,
    swapsCompleted: 4,
    verified: true,
    avatarColor: "#5eead4",
  },
  {
    id: "u-008",
    name: "Julia W.",
    location: "Aarau",
    canton: "AG",
    memberSince: "2026-02-14",
    rating: 4.5,
    swapsCompleted: 1,
    verified: true,
    avatarColor: "#fdba74",
  },
  {
    id: "u-009",
    name: "Reto F.",
    location: "Chur",
    canton: "GR",
    memberSince: "2025-07-25",
    rating: 4.8,
    swapsCompleted: 2,
    verified: true,
    avatarColor: "#a5b4fc",
  },
  {
    id: "u-010",
    name: "Elena V.",
    location: "Lugano",
    canton: "TI",
    memberSince: "2026-03-03",
    rating: 4.6,
    swapsCompleted: 1,
    verified: true,
    avatarColor: "#bef264",
  },
];

export function getUser(id: string): User {
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error(`Unbekannter Nutzer: ${id}`);
  return u;
}

export const currentUser = getUser(CURRENT_USER_ID);
