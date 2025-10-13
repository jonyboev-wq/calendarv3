export const extractEventMeta = (notes?: string) => {
  if (!notes) return { location: undefined, description: undefined };
  const lines = notes.split(/\s*\n+\s*/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { location: undefined, description: undefined };
  const [first, ...rest] = lines;
  return {
    location: first || undefined,
    description: rest.length ? rest.join("\n") : undefined,
  };
};
