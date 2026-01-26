const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigitsToWords = (num: number) => {
  if (num < 20) return ones[num];
  const ten = Math.floor(num / 10);
  const unit = num % 10;
  return `${tens[ten]}${unit ? ` ${ones[unit]}` : ""}`.trim();
};

const threeDigitsToWords = (num: number) => {
  const hundred = Math.floor(num / 100);
  const rest = num % 100;
  if (!hundred) return twoDigitsToWords(rest);
  if (!rest) return `${ones[hundred]} Hundred`;
  return `${ones[hundred]} Hundred ${twoDigitsToWords(rest)}`.trim();
};

const numberToWords = (num: number) => {
  if (num === 0) return "Zero";

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  const parts = [
    crore ? `${threeDigitsToWords(crore)} Crore` : "",
    lakh ? `${threeDigitsToWords(lakh)} Lakh` : "",
    thousand ? `${threeDigitsToWords(thousand)} Thousand` : "",
    remainder ? threeDigitsToWords(remainder) : "",
  ].filter(Boolean);

  return parts.join(" ").trim();
};

export const formatInrWords = (amount: number) => {
  const normalized = Math.abs(amount);
  const rupees = Math.floor(normalized);
  const paise = Math.round((normalized - rupees) * 100);

  const rupeeWords = numberToWords(rupees);
  const paiseWords = paise ? numberToWords(paise) : "";

  if (paise) {
    return `Rupees ${rupeeWords} and Paise ${paiseWords} Only`;
  }

  return `Rupees ${rupeeWords} Only`;
};
