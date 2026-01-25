import { getAmazonAccessToken, spApiSignedFetch } from "../../amazonSpApi";

const FINANCES_API_BASE = "/finances/v0";

type ListFinancialEventGroupsParams = {
  startDate: string;
  endDate: string;
  nextToken?: string;
  signal?: AbortSignal;
};

type ListFinancialEventsByGroupParams = {
  eventGroupId: string;
  nextToken?: string;
  signal?: AbortSignal;
};

type ListFinancialEventsByDateRangeParams = {
  postedAfter: string;
  postedBefore: string;
  nextToken?: string;
  maxPages?: number;
  signal?: AbortSignal;
};

type ListFinancialEventsByDateRangeResult = {
  financialEvents: Record<string, unknown>;
  nextToken?: string;
  debug: {
    pages: number;
    eventsCount: number;
    warnings: string[];
  };
};

const FINANCES_PAGE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function financesListEventGroups({
  startDate,
  endDate,
  nextToken,
  signal,
}: ListFinancialEventGroupsParams): Promise<Record<string, unknown>> {
  const accessToken = await getAmazonAccessToken();
  const query: Record<string, string | number> = {
    FinancialEventGroupStartedAfter: startDate,
    FinancialEventGroupStartedBefore: endDate,
    MaxResultsPerPage: 100,
  };
  if (nextToken) {
    query.NextToken = nextToken;
  }
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${FINANCES_API_BASE}/financialEventGroups`,
    accessToken,
    signal,
    query,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Finances event groups error: ${JSON.stringify(json)}`);
  }

  return json;
}

export async function financesListEventsByGroup({
  eventGroupId,
  nextToken,
  signal,
}: ListFinancialEventsByGroupParams): Promise<Record<string, unknown>> {
  const accessToken = await getAmazonAccessToken();
  const query: Record<string, string | number> = {
    FinancialEventGroupId: eventGroupId,
    MaxResultsPerPage: 100,
  };
  if (nextToken) {
    query.NextToken = nextToken;
  }
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${FINANCES_API_BASE}/financialEvents`,
    accessToken,
    signal,
    query,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Finances events error: ${JSON.stringify(json)}`);
  }

  return json;
}

export async function financesListFinancialEventsByDateRange({
  postedAfter,
  postedBefore,
  nextToken: initialNextToken,
  maxPages = 1,
  signal,
}: ListFinancialEventsByDateRangeParams): Promise<ListFinancialEventsByDateRangeResult> {
  const accessToken = await getAmazonAccessToken();
  const aggregated: Record<string, unknown> = {};
  const warnings: string[] = [];
  let nextToken: string | undefined = initialNextToken;
  let pages = 0;
  let eventsCount = 0;

  do {
    const query: Record<string, string | number> = {
      PostedAfter: postedAfter,
      PostedBefore: postedBefore,
      MaxResultsPerPage: 100,
    };
    if (nextToken) {
      query.NextToken = nextToken;
    }

    try {
      const pageStart = Date.now();
      const res = await spApiSignedFetch({
        method: "GET",
        path: `${FINANCES_API_BASE}/financialEvents`,
        accessToken,
        signal,
        query,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(`Finances events error: ${JSON.stringify(json)}`);
      }

      const payload = (json.payload ?? json.Payload) as Record<string, unknown> | undefined;
      if (!payload) break;

      const financialEvents = (payload.FinancialEvents ?? payload.financialEvents) as
  | Record<string, unknown>
  | undefined;

if (financialEvents && typeof financialEvents === "object") {
  for (const [key, value] of Object.entries(financialEvents)) {
    if (!key.endsWith("EventList") || !Array.isArray(value)) continue;

    const existing = aggregated[key];
    if (Array.isArray(existing)) existing.push(...value);
    else aggregated[key] = [...value];

    eventsCount += value.length;
  }
} else {
  warnings.push("No FinancialEvents object found in payload (unexpected response shape).");
}


      nextToken = typeof payload.NextToken === "string" ? payload.NextToken : undefined;
      pages += 1;
      console.info("[amazon finances] listFinancialEvents page", {
        page: pages,
        durationMs: Date.now() - pageStart,
        nextToken: nextToken ? "present" : "none",
      });
    } catch (error) {
      const filter = {
        PostedAfter: postedAfter,
        PostedBefore: postedBefore,
        NextToken: nextToken ?? "none",
      };
      console.warn("[amazon finances] listFinancialEvents failed", { error: String(error), filter });
      warnings.push(`Failed to fetch financial events page: ${String(error)}`);
      break;
    }

    if (!nextToken || pages >= maxPages) {
      break;
    }

    await sleep(FINANCES_PAGE_DELAY_MS);
  } while (true);

  return {
    financialEvents: aggregated,
    nextToken,
    debug: {
      pages,
      eventsCount,
      warnings,
    },
  };
}
