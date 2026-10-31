export function parseGroupId(group: string): { name: string; to: string }[] {
  return group.split("+").map((entry) => {
    const at = entry.lastIndexOf("@");
    if (at <= 0) throw new Error(`"${entry}" in --group isn't name@version`);
    return { name: entry.slice(0, at), to: entry.slice(at + 1) };
  });
}
