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
