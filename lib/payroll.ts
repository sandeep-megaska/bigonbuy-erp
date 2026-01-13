export type SalaryJson = {
  currency: string;
  effective_from: string;
  pay_frequency: "monthly";
  ctc_annual: number | null;
  earnings: {
    basic_monthly: number;
    hra_monthly: number;
    special_allowance_monthly: number;
    conveyance_monthly: number;
    medical_allowance_monthly: number;
    lta_annual: number;
    bonus_annual: number;
    incentive_annual: number;
    other_allowance_monthly: number;
    arrears_monthly: number;
    overtime_monthly: number;
  };
  statutory: {
    pf: {
      enabled: boolean;
      employee_rate: number;
      employer_rate: number;
      wage_base: "salary_";

      monthly_wage_cap: number;
      voluntary_pf_rate: number;
    };
    esi: {
      enabled: boolean;
      employee_rate: number;
      employer_rate: number;
      eligibility_gross_monthly_threshold: number;
    };
    professional_tax: {
      enabled: boolean;
      state: string;
      monthly_amount: number;
    };
    tds: {
      enabled: boolean;
      monthly_amount: number;
      regime: "old" | "new";
    };
  };
  deductions_other: {
    loan_emi_monthly: number;
    salary_advance_monthly: number;
    other_deductions_monthly: number;
  };
  meta: {
    is_metro_city: boolean;
    notes: string;
  };
};

export type SalaryPreview = {
  gross_monthly: number;
  gross_annual: number;
  employee_pf_monthly: number;
  employer_pf_monthly: number;
  employee_esi_monthly: number;
  employer_esi_monthly: number;
  professional_tax_monthly: number;
  tds_monthly: number;
  other_deductions_monthly: number;
  total_employee_deductions_monthly: number;
  net_pay_monthly: number;
  employer_cost_monthly: number;
  ctc_annual: number;
};

const numberOrZero = (value: unknown): number => {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) return 0;
  return asNumber;
};

export const buildDefaultSalaryJson = (): SalaryJson => ({
  currency: "INR",
  effective_from: "",
  pay_frequency: "monthly",
  ctc_annual: null,
  earnings: {
    basic_monthly: 0,
    hra_monthly: 0,
    special_allowance_monthly: 0,
    conveyance_monthly: 0,
    medical_allowance_monthly: 0,
    lta_annual: 0,
    bonus_annual: 0,
    incentive_annual: 0,
    other_allowance_monthly: 0,
    arrears_monthly: 0,
    overtime_monthly: 0,
  },
  statutory: {
    pf: {
      enabled: true,
      employee_rate: 0.12,
      employer_rate: 0.12,
      wage_base: "salary_",

      monthly_wage_cap: 15000,
      voluntary_pf_rate: 0,
    },
    esi: {
      enabled: false,
      employee_rate: 0.0075,
      employer_rate: 0.0325,
      eligibility_gross_monthly_threshold: 21000,
    },
    professional_tax: {
      enabled: false,
      state: "KA",
      monthly_amount: 0,
    },
    tds: {
      enabled: false,
      monthly_amount: 0,
      regime: "new",
    },
  },
  deductions_other: {
    loan_emi_monthly: 0,
    salary_advance_monthly: 0,
    other_deductions_monthly: 0,
  },
  meta: {
    is_metro_city: false,
    notes: "",
  },
});

export const sanitizeSalaryJson = (input?: Partial<SalaryJson>): SalaryJson => {
  const base = buildDefaultSalaryJson();
  const merged: SalaryJson = {
    ...base,
    ...input,
    effective_from: typeof input?.effective_from === "string" ? input.effective_from : base.effective_from,
    currency: typeof input?.currency === "string" ? input.currency : base.currency,
    pay_frequency: "monthly",
    ctc_annual:
      input && typeof (input as SalaryJson).ctc_annual === "number"
        ? Number((input as SalaryJson).ctc_annual)
        : null,
    earnings: {
      ...base.earnings,
      ...input?.earnings,
    },
    statutory: {
      ...base.statutory,
      ...input?.statutory,
      pf: {
        ...base.statutory.pf,
        ...input?.statutory?.pf,
      },
      esi: {
        ...base.statutory.esi,
        ...input?.statutory?.esi,
      },
      professional_tax: {
        ...base.statutory.professional_tax,
        ...input?.statutory?.professional_tax,
      },
      tds: {
        ...base.statutory.tds,
        ...input?.statutory?.tds,
      },
    },
    deductions_other: {
      ...base.deductions_other,
      ...input?.deductions_other,
    },
    meta: {
      ...base.meta,
      ...input?.meta,
      is_metro_city: Boolean(input?.meta?.is_metro_city ?? base.meta.is_metro_city),
      notes: typeof input?.meta?.notes === "string" ? input.meta.notes : base.meta.notes,
    },
  };

  merged.earnings = Object.fromEntries(
    Object.entries(merged.earnings).map(([key, value]) => [key, numberOrZero(value)]),
  ) as SalaryJson["earnings"];

  merged.statutory.pf = {
    ...merged.statutory.pf,
    employee_rate: numberOrZero(merged.statutory.pf.employee_rate),
    employer_rate: numberOrZero(merged.statutory.pf.employer_rate),
    monthly_wage_cap: Math.max(numberOrZero(merged.statutory.pf.monthly_wage_cap), 0),
    voluntary_pf_rate: numberOrZero(merged.statutory.pf.voluntary_pf_rate),
  };

  merged.statutory.esi = {
    ...merged.statutory.esi,
    employee_rate: numberOrZero(merged.statutory.esi.employee_rate),
    employer_rate: numberOrZero(merged.statutory.esi.employer_rate),
    eligibility_gross_monthly_threshold: Math.max(
      numberOrZero(merged.statutory.esi.eligibility_gross_monthly_threshold),
      0,
    ),
  };

  merged.statutory.professional_tax = {
    ...merged.statutory.professional_tax,
    monthly_amount: Math.max(numberOrZero(merged.statutory.professional_tax.monthly_amount), 0),
    state:
      typeof merged.statutory.professional_tax.state === "string"
        ? merged.statutory.professional_tax.state
        : base.statutory.professional_tax.state,
  };

  merged.statutory.tds = {
    ...merged.statutory.tds,
    monthly_amount: Math.max(numberOrZero(merged.statutory.tds.monthly_amount), 0),
    regime: merged.statutory.tds.regime === "old" ? "old" : "new",
  };

  merged.deductions_other = Object.fromEntries(
    Object.entries(merged.deductions_other).map(([key, value]) => [key, Math.max(numberOrZero(value), 0)]),
  ) as SalaryJson["deductions_other"];

  return merged;
};

export const validateSalaryJson = (salary: SalaryJson): string[] => {
  const errors: string[] = [];
  const numbersToCheck: Array<[string, number]> = [
    ["basic_monthly", salary.earnings.basic_monthly],
    ["hra_monthly", salary.earnings.hra_monthly],
    ["special_allowance_monthly", salary.earnings.special_allowance_monthly],
    ["conveyance_monthly", salary.earnings.conveyance_monthly],
    ["medical_allowance_monthly", salary.earnings.medical_allowance_monthly],
    ["lta_annual", salary.earnings.lta_annual],
    ["bonus_annual", salary.earnings.bonus_annual],
    ["incentive_annual", salary.earnings.incentive_annual],
    ["other_allowance_monthly", salary.earnings.other_allowance_monthly],
    ["arrears_monthly", salary.earnings.arrears_monthly],
    ["overtime_monthly", salary.earnings.overtime_monthly],
    ["loan_emi_monthly", salary.deductions_other.loan_emi_monthly],
    ["salary_advance_monthly", salary.deductions_other.salary_advance_monthly],
    ["other_deductions_monthly", salary.deductions_other.other_deductions_monthly],
  ];

  numbersToCheck.forEach(([label, value]) => {
    if (value < 0) errors.push(`${label} must be >= 0`);
  });

  if (salary.statutory.pf.enabled) {
    if (salary.statutory.pf.employee_rate < 0 || salary.statutory.pf.employee_rate > 0.3) {
      errors.push("PF employee_rate must be between 0 and 0.3");
    }
    if (salary.statutory.pf.employer_rate < 0 || salary.statutory.pf.employer_rate > 0.3) {
      errors.push("PF employer_rate must be between 0 and 0.3");
    }
    if (salary.statutory.pf.voluntary_pf_rate < 0 || salary.statutory.pf.voluntary_pf_rate > 0.3) {
      errors.push("Voluntary PF rate must be between 0 and 0.3");
    }
    if (salary.statutory.pf.monthly_wage_cap <= 0) {
      errors.push("PF monthly_wage_cap must be positive when PF is enabled");
    }
  }

  if (salary.statutory.esi.enabled) {
    if (salary.statutory.esi.eligibility_gross_monthly_threshold <= 0) {
      errors.push("ESI eligibility_gross_monthly_threshold must be positive when ESI is enabled");
    }
  }

  return errors;
};

const capPfBase = (salary: SalaryJson): number => {
  const base = salary.earnings.basic_monthly;
  const cap = salary.statutory.pf.monthly_wage_cap;
  if (cap > 0) return Math.min(base, cap);
  return base;
};

export const calculateSalaryPreview = (raw: SalaryJson): SalaryPreview => {
  const salary = sanitizeSalaryJson(raw);
  const monthlyEarnings =
    salary.earnings.basic_monthly +
    salary.earnings.hra_monthly +
    salary.earnings.special_allowance_monthly +
    salary.earnings.conveyance_monthly +
    salary.earnings.medical_allowance_monthly +
    salary.earnings.other_allowance_monthly +
    salary.earnings.arrears_monthly +
    salary.earnings.overtime_monthly;

  const gross_annual =
    monthlyEarnings * 12 +
    salary.earnings.lta_annual +
    salary.earnings.bonus_annual +
    salary.earnings.incentive_annual;

  let employee_pf_monthly = 0;
  let employer_pf_monthly = 0;
  if (salary.statutory.pf.enabled) {
    const base = capPfBase(salary);
    employee_pf_monthly = base * salary.statutory.pf.employee_rate + base * salary.statutory.pf.voluntary_pf_rate;
    employer_pf_monthly = base * salary.statutory.pf.employer_rate;
  }

  let employee_esi_monthly = 0;
  let employer_esi_monthly = 0;
  if (
    salary.statutory.esi.enabled &&
    monthlyEarnings <= salary.statutory.esi.eligibility_gross_monthly_threshold
  ) {
    employee_esi_monthly = monthlyEarnings * salary.statutory.esi.employee_rate;
    employer_esi_monthly = monthlyEarnings * salary.statutory.esi.employer_rate;
  }

  const professional_tax_monthly = salary.statutory.professional_tax.enabled
    ? salary.statutory.professional_tax.monthly_amount
    : 0;

  const tds_monthly = salary.statutory.tds.enabled ? salary.statutory.tds.monthly_amount : 0;

  const other_deductions_monthly =
    salary.deductions_other.loan_emi_monthly +
    salary.deductions_other.salary_advance_monthly +
    salary.deductions_other.other_deductions_monthly;

  const total_employee_deductions_monthly =
    employee_pf_monthly +
    employee_esi_monthly +
    professional_tax_monthly +
    tds_monthly +
    other_deductions_monthly;

  const net_pay_monthly = monthlyEarnings - total_employee_deductions_monthly;
  const employer_cost_monthly = monthlyEarnings + employer_pf_monthly + employer_esi_monthly;
  const computed_ctc_annual =
    employer_cost_monthly * 12 +
    salary.earnings.bonus_annual +
    salary.earnings.lta_annual +
    salary.earnings.incentive_annual;

  return {
    gross_monthly: monthlyEarnings,
    gross_annual,
    employee_pf_monthly,
    employer_pf_monthly,
    employee_esi_monthly,
    employer_esi_monthly,
    professional_tax_monthly,
    tds_monthly,
    other_deductions_monthly,
    total_employee_deductions_monthly,
    net_pay_monthly,
    employer_cost_monthly,
    ctc_annual: salary.ctc_annual ?? computed_ctc_annual,
  };
};

export const autoSplitFromGross = (
  grossMonthly: number,
  current: SalaryJson,
  options?: { _ratio?: number; hra_non_metro_ratio?: number; hra_metro_ratio?: number },
): SalaryJson => {
 const salary = sanitizeSalaryJson(current);

// ratios (all local, single declaration)
const basicRatio = options?._ratio ?? 0.4; // or options?.basic_ratio ?? 0.4 if that’s what you want
const hraMetroRatio = options?.hra_metro_ratio ?? 0.5;
const hraNonMetroRatio = options?.hra_non_metro_ratio ?? 0.4;
  if (!Number.isFinite(grossMonthly) || grossMonthly <= 0) return salary;

  const basic = grossMonthly * basicRatio;
  const hra = basic * (salary.meta.is_metro_city ? hraMetroRatio : hraNonMetroRatio);

  const fixedOthers =
    salary.earnings.conveyance_monthly +
    salary.earnings.medical_allowance_monthly +
    salary.earnings.other_allowance_monthly +
    salary.earnings.arrears_monthly +
    salary.earnings.overtime_monthly;

  const special = Math.max(grossMonthly - (basic + hra + fixedOthers), 0);

  return {
    ...salary,
    earnings: {
      ...salary.earnings,
      basic_monthly: basic,
      hra_monthly: hra,
      special_allowance_monthly: special,
    },
  };
};
