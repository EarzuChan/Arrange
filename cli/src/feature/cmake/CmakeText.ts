export const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/;/g, "\\;")}"`
