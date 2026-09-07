export function reviewDocumentTitle(repository: string, branch: string, refs: string[] = []) {
  const range = refs.length ? refs.join(" → ") : "local";
  return `${repository} ⋅ ${branch} ⋅ ${range}`;
}
