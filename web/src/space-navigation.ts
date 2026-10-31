// Keep saved links working while presenting the current space/coach vocabulary.
export function canonicalSpacePath(pathname: string) {
  const path = pathname.replace(/^\/admin\/famiglie(?=\/|$)/, '/admin/spazi')
    .replace(/^\/famiglie(?=\/|$)/, '/spazi');
  return path.replace(/^(\/spazi\/[^/]+)\/genitore(?=\/|$)/, '$1/coach');
}
