import Image from "next/image";

/**
 * The two pieces of the Citeproof lockup: the mark, which stands in for the
 * word's capital C, and the wordmark art, which is the master with its own C
 * cropped off at the i's stem.
 *
 * Everything about how they sit together is in the .lockup rules in
 * globals.css and derives from a single --lockup-word, the height of the
 * wordmark art. Render this inside an element carrying .lockup and that
 * variable; the element can be whatever the context wants -- a link in the
 * header, a plain block in the hero.
 */
export function LockupArt({
  markSizes,
  wordSizes,
  priority = false,
}: {
  markSizes: string;
  wordSizes: string;
  priority?: boolean;
}) {
  return (
    <>
      <Image
        src="/brand/citeproof-icon-256.png"
        alt=""
        width={256}
        height={256}
        sizes={markSizes}
        className="lockup-mark"
        priority={priority}
      />
      <Image
        src="/brand/citeproof-wordmark-iteproof.png"
        alt=""
        width={1617}
        height={407}
        sizes={wordSizes}
        className="lockup-word"
        priority={priority}
      />
    </>
  );
}
