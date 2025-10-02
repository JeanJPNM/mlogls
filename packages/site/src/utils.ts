import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";

export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  milliseconds = 100
) {
  let handle: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    if (handle) clearTimeout(handle);

    handle = setTimeout(() => fn(...args), milliseconds);
  };
}

export function utoa(data: string): string {
  const buffer = strToU8(data);
  const zipped = zlibSync(buffer, { level: 9 });
  const binary = strFromU8(zipped, true);
  return btoa(binary);
}

export function atou(base64: string): string {
  const binary = atob(base64);
  const buffer = strToU8(binary, true);
  const unzipped = unzlibSync(buffer);

  return strFromU8(unzipped);
}
