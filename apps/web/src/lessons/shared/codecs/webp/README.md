# Squoosh WebP encoder

Vendored from the repository's `squoosh-dev/` copy of
[GoogleChromeLabs/squoosh](https://github.com/GoogleChromeLabs/squoosh):

- `codecs/webp/enc/webp_enc.js`, `webp_enc.wasm`, `webp_enc.d.ts`
- `src/features/encoders/webP/shared/meta.ts` → `options.ts`

Only the baseline, single-threaded encoder is included. Its WASM is unchanged.
The declaration uses a local factory type; the options import uses a local path.
The generated JavaScript's `createNamedFunction`, `craftInvokerFunction` and
`craftEmvalAllocator` use closures and `Reflect.construct` instead of dynamic
function compilation; `emval_get_global` uses `globalThis` directly and the unused
`new_` helper is removed. This supports Soma's desktop CSP without enabling
JavaScript evaluation. Encoding runs only
in the short-lived lesson worker; its termination releases the codec memory.

`squoosh-dev/` is not needed to build or run Soma. The encoder and upstream default
options retain their original licenses; see `licenses/squoosh.txt` at the repository root.
