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
  signal?: AbortSignal;
};

type ListFinancialEventsByDateRangeResult = {
  financialEvents: Record<string, unknown>;
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
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${FINANCES_API_BASE}/financialEventGroups`,
    accessToken,
    signal,
    query: {
      FinancialEventGroupStartedAfter: startDate,
      FinancialEventGroupStartedBefore: endDate,
      MaxResultsPerPage: 100,
      NextToken: nextToken,
    },
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
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${FINANCES_API_BASE}/financialEvents`,
    accessToken,
    signal,
    query: {
      FinancialEventGroupId: eventGroupId,
      MaxResultsPerPage: 100,
      NextToken: nextToken,
    },
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
  signal,
}: ListFinancialEventsByDateRangeParams): Promise<ListFinancialEventsByDateRangeResult> {
  const accessToken = await getAmazonAccessToken();
  const aggregated: Record<string, unknown> = {};
  const warnings: string[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  let eventsCount = 0;

  do {
    const query = {
      PostedAfter: postedAfter,
      PostedBefore: postedBefore,
      MaxResultsPerPage: 100,
      NextToken: nextToken,
    };

    try {
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

      Object.entries(payload).forEach(([key, value]) => {
        if (!key.endsWith("EventList") || !Array.isArray(value)) return;
        const existing = aggregated[key];
        if (Array.isArray(existing)) {
          existing.push(...value);
        } else {
          aggregated[key] = [...value];
        }
        eventsCount += value.length;
      });

      nextToken = typeof payload.NextToken === "string" ? payload.NextToken : undefined;
      pages += 1;
    } catch (error) {
      const filter = {
        PostedAfter: postedAfter,
        PostedBefore: postedBefore,
        NextToken: nextToken,
      };
      console.warn("[amazon finances] listFinancialEvents failed", { error: String(error), filter });
      warnings.push(`Failed to fetch financial events page: ${String(error)}`);
      break;
    }

    if (nextToken) {
      await sleep(FINANCES_PAGE_DELAY_MS);
    }
  } while (nextToken);

  return {
    financialEvents: aggregated,
    debug: {
      pages,
      eventsCount,
      warnings,
    },
  };
}
