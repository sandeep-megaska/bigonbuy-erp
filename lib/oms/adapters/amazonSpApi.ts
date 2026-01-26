import { gunzipSync } from "zlib";
import { getAmazonAccessToken, spApiSignedFetch } from "../../amazonSpApi";

const FINANCES_API_BASE = "/finances/v0";
const REPORTS_API_BASE = "/reports/2021-06-30";

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

type ListReportsParams = {
  reportTypes: string[];
  processingStatuses?: string[];
  createdSince?: string;
  createdUntil?: string;
  nextToken?: string;
  signal?: AbortSignal;
};

type GetReportParams = {
  reportId: string;
  signal?: AbortSignal;
};

type GetReportDocumentParams = {
  reportDocumentId: string;
  signal?: AbortSignal;
};

type AmazonReport = {
  reportId: string;
  reportType?: string;
  processingStatus?: string;
  createdTime?: string;
  marketplaceIds?: string[];
  reportDocumentId?: string;
};

type AmazonReportDocument = {
  url: string;
  compressionAlgorithm?: string | null;
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

function extractPayload(json: Record<string, unknown>): Record<string, unknown> {
  const payload = (json.payload ?? json.Payload) as Record<string, unknown> | undefined;
  return payload && typeof payload === "object" ? payload : json;
}

export async function amazonListReports({
  reportTypes,
  processingStatuses,
  createdSince,
  createdUntil,
  nextToken,
  signal,
}: ListReportsParams): Promise<{ reports: AmazonReport[]; nextToken?: string }> {
  const accessToken = await getAmazonAccessToken();
  const query: Record<string, string> = {};

  if (reportTypes.length > 0) {
    query.reportTypes = reportTypes.join(",");
  }
  if (processingStatuses && processingStatuses.length > 0) {
    query.processingStatuses = processingStatuses.join(",");
  }
  if (createdSince) query.createdSince = createdSince;
  if (createdUntil) query.createdUntil = createdUntil;
  if (nextToken) query.nextToken = nextToken;

  const res = await spApiSignedFetch({
    method: "GET",
    path: `${REPORTS_API_BASE}/reports`,
    accessToken,
    signal,
    query,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Reports list error: ${JSON.stringify(json)}`);
  }

  const payload = extractPayload(json as Record<string, unknown>);
  const reports = Array.isArray(payload.reports) ? (payload.reports as AmazonReport[]) : [];
  const next = typeof payload.nextToken === "string" ? payload.nextToken : undefined;

  return { reports, nextToken: next };
}

export async function amazonGetReport({
  reportId,
  signal,
}: GetReportParams): Promise<AmazonReport> {
  const accessToken = await getAmazonAccessToken();
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${REPORTS_API_BASE}/reports/${reportId}`,
    accessToken,
    signal,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Report status error: ${JSON.stringify(json)}`);
  }

  const payload = extractPayload(json as Record<string, unknown>);
  return payload as AmazonReport;
}

export async function amazonGetReportDocument({
  reportDocumentId,
  signal,
}: GetReportDocumentParams): Promise<AmazonReportDocument> {
  const accessToken = await getAmazonAccessToken();
  const res = await spApiSignedFetch({
    method: "GET",
    path: `${REPORTS_API_BASE}/documents/${reportDocumentId}`,
    accessToken,
    signal,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Report document error: ${JSON.stringify(json)}`);
  }

  const payload = extractPayload(json as Record<string, unknown>);
  return payload as AmazonReportDocument;
}

export async function amazonDownloadReportDocument({
  reportDocument,
}: {
  reportDocument: AmazonReportDocument;
}): Promise<string> {
  if (!reportDocument.url) {
    throw new Error("Missing report document URL.");
  }

  const response = await fetch(reportDocument.url);
  if (!response.ok) {
    throw new Error(`Failed to download report document: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const decompressed =
    reportDocument.compressionAlgorithm?.toUpperCase() === "GZIP"
      ? gunzipSync(buffer)
      : buffer;

  return decompressed.toString("utf8");
}
