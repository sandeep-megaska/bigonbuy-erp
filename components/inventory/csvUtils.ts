export const createCsvBlob = (content: string) => new Blob([content], { type: "text/csv;charset=utf-8;" });

export const triggerDownload = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
