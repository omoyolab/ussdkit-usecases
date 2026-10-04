// Where the answers come from. The menu only sees CivicSource, so it runs the same on the live API,
// on the saved snapshot, and on the fictional fixture the tests use.

export type Chamber = "senate" | "house";

export interface Person {
  name: string;
  party: string | null;
}

export interface Seat {
  /** INEC's code, such as SD/007/AK or FC/003/AB. */
  code: string;
  name: string;
  chamber: Chamber;
  lgas: string[];
  sittingMember: Person | null;
  candidateCount: number;
}

export interface Candidate extends Person {
  isIncumbent: boolean;
}

export interface Ticket {
  party: string;
  candidate: string | null;
  runningMate: string | null;
}

export interface CivicSource {
  /** Where the data comes from, for the line at the foot of an answer. */
  credit: string;
  /** The states this source can answer for. The live API covers all 37. */
  states: string[];
  lgas(state: string): Promise<string[]>;
  seats(state: string): Promise<Seat[]>;
  candidates(code: string): Promise<Candidate[]>;
  presidential(): Promise<Ticket[]>;
}

/** The API did not answer in time, or answered with an error. The menu says so and ends. */
export class CivicUnavailable extends Error {
  /** The HTTP status when the API answered with an error. A 4xx will not fix itself on a retry. */
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CivicUnavailable";
    this.status = status;
  }
}

/** The 36 states and the FCT, as INEC writes them. */
export const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

/** Lowercase letters and digits only, so "Oshodi-Isolo" and "Oshodi Isolo" match. */
export const key = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every seat that covers this LGA. Most LGAs have one of each; a split LGA has two House seats. */
export function seatsFor(seats: Seat[], lga: string): { senate: Seat[]; house: Seat[] } {
  const k = key(lga);
  const covering = seats.filter((seat) => seat.lgas.some((name) => key(name) === k));
  return {
    senate: covering.filter((seat) => seat.chamber === "senate"),
    house: covering.filter((seat) => seat.chamber === "house"),
  };
}

/**
 * Candidates in a fixed, neutral order: by party, then by name. The API lists the sitting member
 * first; a ballot does not, so neither does this menu. The sitting member is marked instead.
 */
export function neutralOrder<T extends { party: string | null; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.party ?? "").localeCompare(b.party ?? "") || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- live API

export interface LiveOptions {
  apiKey: string;
  baseUrl?: string;
  /** How long to keep an answer. Rosters and candidate lists change rarely. Default six hours. */
  ttlMs?: number;
  /**
   * How long to wait for the API. A network gives a USSD reply only a few seconds,
   * so a slow call has to fail fast and say so. Default 4 seconds.
   */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Envelope<T> {
  data: T;
}

interface ApiSeat {
  code: string;
  name: string;
  chamber: Chamber;
  lgas: string[];
  candidates: number;
  sitting_member: { name: string; party: string | null } | null;
}

/**
 * The plus234feed intel API, with every answer kept in memory for `ttlMs`.
 * A free key allows 100 calls a day, so each state is fetched once and served from memory after that.
 */
export function liveSource(options: LiveOptions): CivicSource & { calls: () => number } {
  const base = (options.baseUrl ?? "https://intel-api.plus234feed.com").replace(/\/$/, "");
  const ttl = options.ttlMs ?? 6 * 60 * 60 * 1000;
  const timeout = options.timeoutMs ?? 4000;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  let calls = 0;

  async function request<T>(path: string): Promise<T> {
    calls++;
    let response: Response;
    try {
      response = await doFetch(base + path, {
        headers: { "X-API-Key": options.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new CivicUnavailable(`${path}: ${(error as Error).name === "TimeoutError" ? "timed out" : (error as Error).message}`);
    }
    if (!response.ok) throw new CivicUnavailable(`${path}: HTTP ${response.status}`, response.status);
    return ((await response.json()) as Envelope<T>).data;
  }

  /** One request per path at a time, kept for the TTL. A failed request is not kept. */
  function cached<T>(path: string): Promise<T> {
    const hit = cache.get(path);
    if (hit && now() - hit.at < ttl) return hit.value as Promise<T>;
    const value = request<T>(path);
    cache.set(path, { at: now(), value });
    value.catch(() => cache.delete(path));
    return value;
  }

  const state = (name: string) => encodeURIComponent(name);

  return {
    credit: "INEC and NASS records, via plus234feed",
    states: STATES,
    calls: () => calls,
    async lgas(name) {
      const data = await cached<{ lgas: string[] }>(`/v1/states/${state(name)}/lgas`);
      return data.lgas;
    },
    async seats(name) {
      const data = await cached<{ seats: ApiSeat[] }>(`/v1/elections/2027/seats?state=${state(name)}`);
      return data.seats.map((s) => ({
        code: s.code,
        name: s.name,
        chamber: s.chamber,
        lgas: s.lgas,
        candidateCount: s.candidates,
        sittingMember: s.sitting_member ? { name: s.sitting_member.name, party: s.sitting_member.party } : null,
      }));
    },
    async candidates(code) {
      const data = await cached<{ candidates: Array<{ name: string; party: string | null; is_incumbent: boolean }> }>(
        `/v1/elections/2027/seats/${code.replace(/\//g, "-")}`,
      );
      return data.candidates.map((c) => ({ name: c.name, party: c.party, isIncumbent: c.is_incumbent }));
    },
    async presidential() {
      const data = await cached<{ tickets: Array<{ party: string; candidate: string | null; running_mate: string | null }> }>(
        "/v1/elections/2027/presidential",
      );
      return data.tickets.map((t) => ({ party: t.party, candidate: t.candidate, runningMate: t.running_mate }));
    },
  };
}

// ---------------------------------------------------------------- saved data

/** The shape of data/snapshot.json, and of the tests' fixture. */
export interface Snapshot {
  savedAt: string;
  credit: string;
  states: Record<string, { lgas: string[]; seats: Seat[] }>;
  candidates: Record<string, Candidate[]>;
  presidential: Ticket[];
}

/** Answers from a saved file. A state that is not in it says so. */
export function snapshotSource(snapshot: Snapshot): CivicSource {
  const stateOf = (name: string) => {
    const found = snapshot.states[name];
    if (!found) throw new CivicUnavailable(`${name} is not in the saved data`);
    return found;
  };
  return {
    credit: snapshot.credit,
    states: STATES.filter((name) => name in snapshot.states),
    lgas: async (name) => stateOf(name).lgas,
    seats: async (name) => stateOf(name).seats,
    candidates: async (code) => snapshot.candidates[code] ?? [],
    presidential: async () => snapshot.presidential,
  };
}
