/**
 * Parity oracle for the Indexer's perceptual-hash port.
 *
 * Runs the album app's REAL `perceptualHash` (src/lib/media/image-hash.ts, which
 * uses sharp) over one or more image files and prints `{ "<path>": "<hash>" }`
 * as JSON. The Python test suite (tests/test_phash.py) shells out to this via
 * `tsx` and asserts the Python port produces byte-identical hashes.
 *
 * Must live inside the repo so `sharp` and the `src/` import resolve against the
 * app's node_modules. Run with the repo's tsx:
 *
 *   node_modules/.bin/tsx tools/backfill-indexer/reference_hash.ts <img>...
 */
import { readFileSync } from "fs";
import { perceptualHash } from "../../src/lib/media/image-hash";

async function main() {
  const files = process.argv.slice(2);
  const out: Record<string, string | null> = {};
  for (const f of files) {
    out[f] = await perceptualHash(readFileSync(f));
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
