export function parsePatch(patch, path, status = "M") {
  const file = {
    path,
    status,
    additions: 0,
    deletions: 0,
    binary: false,
    hunks: [],
  };
  let h;
  for (const line of patch.split("\n")) {
    const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (match) {
      h = { header: line, oldStart: +match[1], newStart: +match[2], lines: [] };
      file.hunks.push(h);
      continue;
    }
    if (/^Binary files |^GIT binary patch/.test(line)) file.binary = true;
    if (h && /^[ +\-\\]/.test(line)) {
      h.lines.push(line);
      if (line[0] === "+") file.additions++;
      if (line[0] === "-") file.deletions++;
    }
  }
  return file;
}
