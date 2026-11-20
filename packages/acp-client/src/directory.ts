export const normalDirectory = (path: string): string => {
  let end = path.length;
  while (end > 0 && path.charAt(end - 1) === "/") end -= 1;
  return path.slice(0, end);
};

export const sameDirectory = (a: string, b: string): boolean =>
  normalDirectory(a) === normalDirectory(b);
