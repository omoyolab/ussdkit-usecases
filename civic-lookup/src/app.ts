// The menu. Everything a caller sees is in this file.
//
// One rule runs through it: data is loaded in a handler, before the move to the next screen, and
// screens draw from what is already loaded. A handler can end the session politely when the API
// does not answer; a screen that throws while drawing cannot.
import { createApp, info, lines, list, menu, paginate } from "@omoyolab/ussdkit";
import type { App, Context, Next } from "@omoyolab/ussdkit";

import { CivicUnavailable, neutralOrder, seatsFor } from "./civic.js";
import type { CivicSource, Person, Seat } from "./civic.js";

type Want = "reps" | "running";

/** What a session remembers between screens. */
interface Flow {
  want: Want;
  state: string;
  lga: string;
  seatCode: string;
  listPage: number;
}
type Ctx = Context<Flow>;

export const TITLE = "Know your lawmakers";
export const NOT_AVAILABLE = "Sorry, this list is not available yet. Dial again to look up another seat.";
export const SORRY = "Sorry, the records could not be reached just now. Please dial again in a few minutes.";

/**
 * A name short enough for a USSD line. Long names keep the first and last word, which is how
 * people are known; only a name still too long is cut.
 */
export function shortName(name: string, max = 24): string {
  // INEC's lists sometimes break a double-barrelled name: "Olatunbosun- Olarewaju".
  const clean = name.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const words = clean.split(" ");
  const firstLast = words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : clean;
  return firstLast.length <= max ? firstLast : `${firstLast.slice(0, max - 1).trimEnd()}.`;
}

const person = (p: Person | null, max = 24): string =>
  p ? `${shortName(p.name, max)}${p.party ? ` (${p.party})` : ""}` : "No sitting member on record";

export interface BuildOptions {
  source: CivicSource;
  onWarning?: (message: string) => void;
}

export function buildApp({ source, onWarning }: BuildOptions): App<Flow> {
  /** Runs a load, and turns a failed API call into a polite end. */
  async function load<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; next: Next<Flow> }> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      if (error instanceof CivicUnavailable) {
        onWarning?.(`civic data unavailable: ${error.message}`);
        // A refused request will be refused again, so do not ask the caller to dial again.
        const refused = error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429;
        return { ok: false, next: { end: refused ? NOT_AVAILABLE : SORRY } };
      }
      throw error;
    }
  }

  /** The seats covering the chosen LGA, from the state's seats already loaded. */
  const covering = async (ctx: Ctx) => seatsFor(await source.seats(ctx.data.state!), ctx.data.lga!);
  const place = (ctx: Ctx) => `${ctx.data.lga}, ${ctx.data.state}`;

  return createApp<Flow>({
    ttl: 120,
    backHint: "0. Back",
    homeHint: "00. Home",
    ...(onWarning ? { onWarning } : {}),
    // Anything that still throws ends with an apology, not a failed request.
    onError: (error) => {
      onWarning?.(`error: ${(error as Error).message}`);
      return SORRY;
    },
  })
    .screen(
      "home",
      menu(TITLE, [
        ["My senator and rep", () => ({ goto: "state", data: { want: "reps" as Want } })],
        ["Who is running in 2027", () => ({ goto: "state", data: { want: "running" as Want } })],
        [
          "Presidential candidates",
          async () => {
            const loaded = await load(() => source.presidential());
            return loaded.ok ? { goto: "presidential", data: { listPage: 0 } } : loaded.next;
          },
        ],
        ["About this service", "about"],
      ]),
    )

    // ---------- Where you live: state, then LGA ----------
    .screen(
      "state",
      list<Flow>(
        "Choose your state",
        () => source.states,
        async (state) => {
          const loaded = await load(() => Promise.all([source.lgas(state), source.seats(state)]));
          return loaded.ok ? { goto: "lga", data: { state } } : loaded.next;
        },
        { perPage: 6, filter: true },
      ),
    )
    .screen(
      "lga",
      list<Flow>(
        (ctx) => `${ctx.data.state}: choose your LGA`,
        (ctx) => source.lgas(ctx.data.state!),
        (lga, ctx) => ({ goto: ctx.data.want === "running" ? "running" : "reps", data: { lga } }),
        { perPage: 6, filter: true },
      ),
    )

    // ---------- Who represents you now ----------
    .screen(
      "reps",
      menu(
        async (ctx) => {
          const { senate, house } = await covering(ctx);
          if (senate.length + house.length === 0) return `${place(ctx)}\nNo seat on record for this LGA.`;
          const split = house.length > 1 ? [`${house.length} House seats cover it:`] : [];
          // With the seat names, when they fit in the room ussdkit says is left.
          const full = [
            place(ctx),
            ...senate.flatMap((seat) => [`Senator, ${seat.name}:`, person(seat.sittingMember)]),
            ...split,
            ...house.flatMap((seat) => [`Rep, ${seat.name}:`, person(seat.sittingMember)]),
          ].join("\n");
          if (full.length <= ctx.room) return full;
          // Without them. The seat names are on the 2027 screen, one key away.
          const compact = [
            place(ctx),
            ...senate.map((seat) => `Senator: ${person(seat.sittingMember)}`),
            ...split,
            ...house.map((seat) => `Rep: ${person(seat.sittingMember)}`),
          ].join("\n");
          if (compact.length <= ctx.room) return compact;
          // Tighter still: shorter names, and the two Rep lines say the rest.
          return [
            place(ctx),
            ...senate.map((seat) => `Senator: ${person(seat.sittingMember, 18)}`),
            ...house.map((seat) => `Rep: ${person(seat.sittingMember, 18)}`),
          ].join("\n");
        },
        [["Who is running in 2027", () => ({ goto: "running", data: { want: "running" as Want } })]],
      ),
    )

    // ---------- Who is running in 2027 ----------
    .screen("running", {
      render: async (ctx) => {
        const seats = await seatList(ctx);
        return lines(
          `${place(ctx)}: 2027`,
          ...seats.map((seat, i) => `${i + 1}. ${label(seat)}: ${seat.candidateCount} running`),
        );
      },
      handle: async (ctx) => {
        const seats = await seatList(ctx);
        const seat = seats[Number(ctx.input) - 1];
        if (!seat) return { retry: "Choose a seat from the list." };
        const loaded = await load(() => source.candidates(seat.code));
        if (!loaded.ok) return loaded.next;
        return { goto: "candidates", data: { seatCode: seat.code, listPage: 0 } };
      },
    })
    .screen("candidates", {
      render: async (ctx) => {
        const seat = (await source.seats(ctx.data.state!)).find((s) => s.code === ctx.data.seatCode)!;
        const all = neutralOrder(await source.candidates(seat.code));
        const page = paginate(
          all.map((c) => `${c.party ?? "?"}: ${shortName(c.name, 22)}${c.isIncumbent ? "*" : ""}`),
          { page: ctx.data.listPage ?? 0, perPage: 4, numbered: false },
        );
        // The note goes on the page that shows the mark, above the page keys.
        const nav = page.text.split("\n").slice(page.items.length);
        const sitting = page.items.some((row) => row.endsWith("*")) ? "*sitting member" : "";
        const footer = page.hasNext ? "" : `Source: ${source.credit}`;
        return lines(label(seat), ...page.items, sitting, footer, ...nav);
      },
      handle: async (ctx) => turnPage(ctx, (await source.candidates(ctx.data.seatCode!)).length, 4),
    })

    // ---------- Presidential tickets ----------
    .screen("presidential", {
      render: async (ctx) => {
        const tickets = neutralOrder((await source.presidential()).map((t) => ({ ...t, name: t.candidate ?? "" })));
        const page = paginate(
          tickets.map((t) => `${t.party}: ${t.candidate ? shortName(t.candidate, 22) : "not yet named"}`),
          { page: ctx.data.listPage ?? 0, perPage: 5, numbered: false },
        );
        return lines("President, 2027", page.text, page.hasNext ? "" : `Source: ${source.credit}`);
      },
      handle: async (ctx) => turnPage(ctx, (await source.presidential()).length, 5),
    })

    .screen(
      "about",
      info(
        lines(
          TITLE,
          "Find your senator and House member, and who is running for their seats in 2027.",
          `Data: ${source.credit}. Not a government service.`,
        ),
      ),
    );

  /** Senate seats first, then House, for the chosen LGA. */
  async function seatList(ctx: Ctx): Promise<Seat[]> {
    const { senate, house } = await covering(ctx);
    return [...senate, ...house];
  }

  function label(seat: Seat): string {
    return `${seat.chamber === "senate" ? "Senate" : "House"}, ${seat.name}`;
  }

  /** 9 for the next page, 8 for the one before; anything else just shows the page again. */
  function turnPage(ctx: Ctx, total: number, perPage: number): Next<Flow> {
    const page = paginate(Array.from({ length: total }, () => ""), { page: ctx.data.listPage ?? 0, perPage, numbered: false });
    if (page.isNext(ctx.input)) ctx.data.listPage = page.page + 1;
    else if (page.isPrev(ctx.input)) ctx.data.listPage = page.page - 1;
    return { stay: true };
  }
}
