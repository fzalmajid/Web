// A bare numeric underscore needs a variable/element immediately before it.
// Otherwise _54 ± 0.81_ is emphasis, not a subscript. The lookahead also
// prevents backtracking into a partial match such as _5 inside _54_.
const scripts=/(\^\{[^{}\n]+\}|\^\([^()\n]+\)|\^[*+\-0-9A-Za-z]+|_\{[^{}\n]+\}|(?<=[A-Za-zπσλαβγδε])_[0-9]+(?:\/[0-9]+)?(?![0-9/_])|(?<=[A-Za-zπσλαβγδε])_[A-Za-z][A-Za-z0-9]*(?![A-Za-z0-9_]))/;
const emphasis=/(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_(?:_\{[^{}\n]+\}|[^_\n])+_)/;

export function scientificScriptPattern(){return new RegExp(scripts.source,"g");}

/** Explicit scripts take precedence only when they are valid scientific tokens. */
export function scientificRichPattern(){return new RegExp(scripts.source+"|"+emphasis.source,"g");}
