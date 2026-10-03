/** Prefer explicit scientific scripts to emphasis; don't consume a closing underscore. */
export function scientificRichPattern() {
  return /(\^\{[^{}\n]+\}|\^\([^()\n]+\)|\^[*+\-0-9A-Za-z]+|_\{[^{}\n]+\}|_[0-9]+(?:\/[0-9]+)?(?!_)|(?<=[A-Za-zπσλαβγδε])_[A-Za-z][A-Za-z0-9]*(?![A-Za-z0-9_])|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
}
